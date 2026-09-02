/**
 * The "is this done" checks, split from checklist-engine.ts.
 *
 * The engine imports the email client, which constructs a Resend instance at
 * module scope — importing it anywhere drags that in and throws without an API
 * key. These checks are read-only database logic that other surfaces need (the
 * exhibitor's own to-do list renders the same state the reminder email would),
 * so they live where they can be imported freely, exactly as
 * checklist-check-types.ts was split before them.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { loadDirectoryCompleteness } from "@/lib/publication/completeness-loader";
import { computeOrgLegalCompleteness } from "./legal-acceptance";
import type { CheckType } from "./checklist-check-types";

type AdminClient = ReturnType<typeof createAdminClient>;

type CheckArgs = {
  db: AdminClient;
  organizationId: string;
  conferenceId: string;
  /** The task's `check_entity_id` — FK'd to conference_entities, so a catalog thing. */
  entityId: string | null;
  /** The task's own id. `self_reported` keys its acknowledgement on this. */
  taskId: string;
};

export const CHECKS: Record<CheckType, (args: CheckArgs) => Promise<boolean>> = {
  /**
   * Has this org assigned the people to the seats it holds?
   *
   * ⚠️ Sweeps every entity of the SAME KIND the org holds, not the single
   * entity named on the task.
   *
   * The named-entity version silently passed anyone holding an equivalent
   * entity under a different name. Measured 2026-08-25: the task pointed at
   * "Exhibitor Staff Registration" while 12 orgs held "Connected Exhibitor
   * Staff Registration" — two independent entities with no `instance_of`
   * between them. All 12 were reported complete with **zero** people assigned
   * and 60 seats unfilled, on the only checklist that was live. A booth with
   * nobody assigned cannot be checked in on site, so this failed in the
   * direction that costs the most.
   *
   * The "holds none of this — nothing to assign" shortcut was not itself
   * wrong; it was the right answer to the wrong question. Now "nothing to
   * assign" means the org holds no seats of that kind at all.
   *
   * Kind rather than every seat-bearing entity, deliberately: `event` and
   * `membership_renewal` also carry seats, and neither is booth staff.
   */
  async seat_assigned({ db, organizationId, conferenceId, entityId }) {
    if (!entityId) return true; // malformed task — never blocks, but shouldn't happen (form requires it)

    const { data: named } = await db
      .from("conference_entities")
      .select("kind")
      .eq("id", entityId)
      .maybeSingle();
    if (!named?.kind) return true;

    const { data: seats } = await db
      .from("entity_balance_seats")
      .select("entity_id, holder_person_id, entity:conference_entities!inner(kind)")
      .eq("organization_id", organizationId)
      .eq("conference_id", conferenceId)
      .eq("entity.kind", named.kind);
    // Genuinely nothing of this kind on their account.
    if (!seats || seats.length === 0) return true;

    const byEntity = new Map<string, (boolean | null)[]>();
    for (const row of seats) {
      if (!row.entity_id) continue;
      const list = byEntity.get(row.entity_id) ?? [];
      list.push(row.holder_person_id !== null);
      byEntity.set(row.entity_id, list);
    }

    const { data: intents } = await db
      .from("conference_entity_usage_intents")
      .select("entity_id, intended_quantity, declared_against_total")
      .eq("organization_id", organizationId)
      .eq("conference_id", conferenceId)
      .in("entity_id", [...byEntity.keys()]);
    const intentByEntity = new Map(
      (intents ?? []).map((i) => [i.entity_id, i])
    );

    // Every entity of this kind must be satisfied. One fully-staffed
    // registration type does not excuse an empty one.
    for (const [id, assignments] of byEntity) {
      const total = assignments.length;
      const assignedCount = assignments.filter(Boolean).length;
      const intent = intentByEntity.get(id);

      // "All purchased seats assigned" is only the right definition of done
      // when the org intends to use every seat it bought — someone who buys 4
      // and is sending 1 isn't behind, they're done. Their declared number is
      // what complete means instead, capped at the real seat count so a stale
      // over-declaration can never make this impossible to satisfy.
      //
      // A later purchase can raise the real count past what they saw when they
      // declared — said "using 1 of 4", then bought 2 more, now holding 6. The
      // old "1" no longer reflects a decision about the extra seats, so it is
      // treated as stale and falls through to strict until they re-declare.
      if (intent && total <= intent.declared_against_total) {
        if (assignedCount < Math.min(intent.intended_quantity, total)) return false;
        continue;
      }
      if (assignedCount < total) return false;
    }
    return true;
  },

  async entity_purchased({ db, organizationId, entityId }) {
    if (!entityId) return true;
    const { count } = await db
      .from("entity_balances")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("entity_id", entityId);
    return (count ?? 0) > 0;
  },

  async travel_info_submitted({ db, organizationId, conferenceId }) {
    const { data } = await db
      .from("conference_people")
      .select("travel_mode")
      .eq("organization_id", organizationId)
      .eq("conference_id", conferenceId);
    if (!data || data.length === 0) return false; // nobody registered yet — not complete
    return data.every((p) => p.travel_mode !== null);
  },

  /**
   * Does this org owe anything for the conference?
   *
   * Two corrections over the original, both of the same family as the
   * seat_assigned bug — the right answer to the wrong question:
   *
   * 1. It asked "have you paid ANYTHING?" — one paid order marked the whole
   *    task complete no matter what else was outstanding. Now it asks whether
   *    anything is unsettled, which is what the task actually claims.
   * 2. It gated on `paid_at`, which is not reliably populated: on CSC 2027 an
   *    order carries status 'paid' with a null `paid_at` (Varsity Collection,
   *    $9,040, two booths). That would have told a company it had not paid for
   *    booths it holds. `status` is what the refund and reconciliation paths
   *    maintain.
   *
   * Cancelled and expired orders are not debts, so they never block.
   */
  /**
   * Have they told us who they most want to meet?
   *
   * Detectable rather than self_reported — we can see whether a row exists, so
   * asking someone to tick "yes I did that" would be asking them to confirm
   * something we already know, and lets a task read complete when it is not.
   *
   * ⚠️ ANY choice counts, not five. The ask is "tell us who you want to meet";
   * someone with two people they care about has answered it. Requiring the full
   * five would push people to pad the list with orgs they do not care about,
   * which is worse than a short honest list — the padding is indistinguishable
   * from real interest once it reaches the scheduler.
   */
  async top_choices_declared({ db, organizationId, conferenceId }) {
    // The generated types do not know this table yet and another session holds
    // uncommitted changes in lib/database.types.ts, so regenerating would be a
    // merge decision rather than a type fix. Narrow shim, same as
    // lib/conference/top-choices.ts — delete both at the next coordinated regen.
    const anyDb = db as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (table: string) => any;
    };
    const { data } = await anyDb
      .from("conference_top_choices")
      .select("id")
      .eq("conference_id", conferenceId)
      .eq("declaring_org_id", organizationId)
      .limit(1);
    return Boolean(data && data.length > 0);
  },

  async payment_complete({ db, organizationId, conferenceId }) {
    const { data } = await db
      .from("conference_orders")
      .select("status")
      .eq("organization_id", organizationId)
      .eq("conference_id", conferenceId);
    if (!data || data.length === 0) return true; // bought nothing — owes nothing

    const settled = new Set(["paid", "partially_refunded", "refunded"]);
    const ignored = new Set(["canceled", "cancelled", "expired"]);
    return data.every((o) => settled.has(o.status) || ignored.has(o.status));
  },

  async legal_document_accepted({ db, organizationId, conferenceId }) {
    return computeOrgLegalCompleteness(db, conferenceId, organizationId);
  },

  /**
   * Everything the printed directory needs from this org's profile.
   *
   * "Done" is the required tier of PUBLICATION_FIELDS — logo, description,
   * categories, at least one contact — read straight off `organizations`, the
   * same derivation the gap report and the print-readiness gate use. It is
   * deliberately not the enhanced tier: a listing missing a hero image still
   * prints, so blocking on one would cry wolf.
   *
   * This is the check that reaches the orgs nothing else can. Onboarding
   * nudges need a `user_onboarding_progress` journey, which only exists after
   * someone logs in — 29 of 78 partners. Checklist reminders resolve through
   * `org_admins`, which needs only a provisioned account: 76 of 78, and 30 of
   * 30 exhibitors.
   */
  async directory_profile_complete({ organizationId }) {
    const rows = await loadDirectoryCompleteness({ orgIds: [organizationId] });
    // No row means the org isn't in the directory population at all — nothing
    // to chase, so never block them on it.
    return rows.length === 0 ? true : rows[0].isPrintReady;
  },

  /**
   * Things that happen on someone else's system — Stronco's portal, Encore's
   * emailed order form, a hotel booking. CSC can't observe any of them, so the
   * exhibitor ticks them off and we record who said so.
   *
   * "Not applicable" counts as done. Someone staying at their own hotel is not
   * behind; nagging them until February teaches them to ignore the reminders
   * that DO cost money if missed.
   *
   * Org-level only here, because this engine is org-scoped throughout — reminders
   * resolve to org admins, and the user's rule is "org admins answer for the
   * company, people answer for themselves." Per-person items (hotel, travel,
   * assignee-accepted policies) surface through resolvePersonObligations on
   * /me/conference instead, reading the same table with person_id set.
   */
  /**
   * The half of a listing that makes it worth reading: featured product and a
   * catalogue link. Separate from `directory_profile_complete` on purpose —
   * that one gates whether an entry can print at all, this one is what turns a
   * name and a booth number into something a member acts on.
   *
   * Kept as its own task so a partner who is technically "print-ready" still
   * gets asked. These are the worst-filled fields on the whole platform (31 and
   * 36 of 78 missing), and folding them into the required check would either
   * block listings that should print, or let them stay empty unnoticed.
   */
  async directory_profile_enriched({ organizationId }) {
    const rows = await loadDirectoryCompleteness({ orgIds: [organizationId] });
    if (rows.length === 0) return true;
    return rows[0].enhancedFilled === rows[0].enhancedTotal;
  },

  async self_reported({ db, organizationId, conferenceId, taskId }) {
    const { data } = await db
      .from("conference_task_acknowledgements")
      .select("state")
      .eq("task_id", taskId)
      .eq("organization_id", organizationId)
      .eq("conference_id", conferenceId)
      .is("person_id", null)
      .maybeSingle();
    return Boolean(data);
  },
};


export async function evaluateChecklistTaskCheck(
  db: AdminClient,
  checkType: CheckType,
  organizationId: string,
  conferenceId: string,
  entityId: string | null,
  taskId: string
): Promise<boolean> {
  return CHECKS[checkType]({ db, organizationId, conferenceId, entityId, taskId });
}
