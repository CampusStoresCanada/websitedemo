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
  async seat_assigned({ db, organizationId, conferenceId, entityId }) {
    if (!entityId) return true; // malformed task — never blocks, but shouldn't happen (form requires it)
    const { data } = await db
      .from("entity_balance_seats")
      .select("holder_person_id")
      .eq("organization_id", organizationId)
      .eq("entity_id", entityId);
    if (!data || data.length === 0) return true; // org holds none of this entity — nothing to assign
    const assignedCount = data.filter((s) => s.holder_person_id !== null).length;

    // "All purchased seats assigned" is only the right definition of done
    // when the org actually intends to use every seat it bought — someone
    // who buys 4 exhibitor registrations but is only sending 1 person isn't
    // "behind," they're done. If they've told us how many they actually
    // plan to use (conference_entity_usage_intents), that number is what
    // "complete" means instead — capped at the real seat count so a stale
    // over-declaration can never make this impossible to satisfy.
    const { data: intent } = await db
      .from("conference_entity_usage_intents")
      .select("intended_quantity, declared_against_total")
      .eq("organization_id", organizationId)
      .eq("entity_id", entityId)
      .eq("conference_id", conferenceId)
      .maybeSingle();

    // A later purchase can raise the real seat count past what the org saw
    // when they declared — e.g. they said "using 1 of 4," then bought 2
    // more, now holding 6. The old "1" no longer reflects a real decision
    // about those extra seats, so it's treated as stale (not merely
    // clamped) and this falls through to strict mode until they re-declare.
    if (intent && data.length <= intent.declared_against_total) {
      return assignedCount >= Math.min(intent.intended_quantity, data.length);
    }

    // No declared intent, or the declaration is stale — fall back to the
    // original strict definition.
    return data.every((s) => s.holder_person_id !== null);
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

  async payment_complete({ db, organizationId, conferenceId }) {
    const { count } = await db
      .from("conference_orders")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("conference_id", conferenceId)
      .not("paid_at", "is", null);
    return (count ?? 0) > 0;
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
