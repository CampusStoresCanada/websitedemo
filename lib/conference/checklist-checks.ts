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
import type { CheckType, StaffCheckType } from "./checklist-check-types";
import { formatDayMonth } from "@/lib/time/supabase-timestamp";

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
      /**
       * ⛔ ORG-GRAIN ROWS ONLY. Without this a delegate picking their own five
       * ticked off their COMPANY'S task — while the org page, which reads
       * `chosenBy(orgId)`, still showed an empty list. The check and the surface
       * disagreed, and the direction of the error was the expensive one: the
       * exhibitor stops being asked for the list the scheduler actually needs.
       */
      .is("declaring_contact_id", null)
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


/**
 * Checks that can be answered ABOUT ONE PERSON rather than about a company.
 *
 * ⛔ Deliberately a separate, sparse registry — not a widened CheckArgs. Most
 * checks have no person-grain meaning at all: payment, agreements and the
 * directory listing are answered by a company, and inventing a per-person
 * version would report a delegate incomplete for something they cannot do.
 * A check appears here only when the underlying capture is genuinely keyed to
 * the person. A task whose type is absent falls back to `self_reported` — the
 * tick — which is what every person task did before this existed.
 *
 * ⛔ EACH ONE IS WRITTEN ONCE, IN BULK. Two surfaces ask this question: an
 * attendee's own agenda ("have I done it?") and the admin roll-up ("how many
 * haven't?"). A per-person implementation plus a separate counting query is two
 * implementations of one rule, and checklist-status.ts already carries a header
 * warning that its copy of the state rules must never drift from the loader's.
 * So the bulk answer is the only answer, and the single-person check is a `has`
 * against it — they cannot disagree.
 */
export const PERSON_CHECKS_BULK: Partial<
  Record<CheckType, (args: { db: AdminClient; conferenceId: string }) => Promise<Set<string>>>
> = {
  /**
   * Which contacts have told us who they want to meet.
   *
   * ⛔ Keyed on `declaring_contact_id`, never on their org. Three buyers from
   * one store want three different sets of meetings, so a colleague answering
   * must not tick this off for everyone — which is exactly what reusing the
   * org-grain check would have done.
   *
   * ⚠️ ANY choice counts, not five — same rule as the org version. Requiring
   * the full five pushes people to pad the list, and padding is
   * indistinguishable from real interest by the time it reaches the scheduler.
   */
  async top_choices_declared({ db, conferenceId }) {
    // Same narrow shim as the org version above — the generated types do not
    // know this table yet. Delete both at the next coordinated regen.
    const anyDb = db as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (table: string) => any;
    };
    const { data } = await anyDb
      .from("conference_top_choices")
      .select("declaring_contact_id")
      .eq("conference_id", conferenceId)
      .not("declaring_contact_id", "is", null);
    return new Set(
      ((data ?? []) as Array<{ declaring_contact_id: string | null }>)
        .map((r) => r.declaring_contact_id)
        .filter((id): id is string => Boolean(id))
    );
  },
};

/**
 * Run a person-grain check, or return null when this task has none.
 *
 * Null rather than false: "no person-grain check exists" and "this person has
 * not done it" are different answers, and collapsing them would mark every
 * company task incomplete on every attendee's own list.
 */
export async function evaluatePersonChecklistTaskCheck(
  db: AdminClient,
  checkType: CheckType,
  conferenceId: string,
  contactId: string
): Promise<boolean | null> {
  const check = PERSON_CHECKS_BULK[checkType];
  if (!check) return null;
  return (await check({ db, conferenceId })).has(contactId);
}

export async function evaluateChecklistTaskCheck(
  db: AdminClient,
  checkType: CheckType,
  organizationId: string,
  conferenceId: string,
  entityId: string | null,
  taskId: string
): Promise<boolean> {
  const check = CHECKS[checkType] as (typeof CHECKS)[CheckType] | undefined;
  // A staff task's check reads the conference, not a company: asked about an
  // org it has no answer, and it must not throw inside a comms condition.
  if (!check) return false;
  return check({ db, organizationId, conferenceId, entityId, taskId });
}

/**
 * Checks CSC staff answer for the conference itself — the War Room.
 *
 * ⛔ A third registry, like PERSON_CHECKS_BULK, not entries in CHECKS: every
 * org check takes an organization, and "is the print station online" has none.
 *
 * Each returns a VERDICT, not a boolean, because most print jobs are things
 * the site can describe but not see happen. Nothing records that a sheet came
 * off a printer, so "tick" means: here is what there is to print and where;
 * a staff member's tick says it was. `done` / `not_done` are read from data and
 * a tick cannot override them — a badge package with 21 people added since is
 * not done whatever anyone ticked in September.
 */
export type StaffCheckResult = {
  verdict: "done" | "not_done" | "tick";
  /** The live line under the task: what there is, from real data. */
  detail: string | null;
  /** Where to do it. `print` opens in a new tab, as every print page does. */
  actions: { label: string; href: string; print?: boolean }[];
};

/** When something happened, said in the operator's zone (Mountain). */
const OPERATOR_TIME_ZONE = "America/Edmonton";

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

type StaffCheck = (args: { db: AdminClient; conferenceId: string }) => Promise<StaffCheckResult>;

export const STAFF_CHECKS: Record<StaffCheckType, StaffCheck> = {
  /**
   * The pre-printed badge run, against everyone registered since.
   *
   * Current = a package exists and nobody was added after it was made. Even
   * then it is a tick: the site knows a PDF was made, not that it was printed.
   */
  async badge_package_current({ db, conferenceId }) {
    const actions = [{ label: "Open Badge Ops", href: `/admin/conference/${conferenceId}/badges` }];
    const { data: job } = await db
      .from("badge_print_jobs")
      .select("created_at")
      .eq("conference_id", conferenceId)
      .eq("pipeline_type", "preprinted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!job) return { verdict: "not_done", detail: "No badge package has been made yet.", actions };
    const made = formatDayMonth(job.created_at, OPERATOR_TIME_ZONE) ?? "earlier";
    const { count } = await db
      .from("conference_people")
      .select("id", { count: "exact", head: true })
      .eq("conference_id", conferenceId)
      .neq("assignment_status", "canceled")
      .gt("created_at", job.created_at);
    const since = count ?? 0;
    if (since > 0) {
      return {
        verdict: "not_done",
        detail: `Made ${made}; ${plural(since, "person", "people")} added since. Make a new one.`,
        actions,
      };
    }
    return { verdict: "tick", detail: `Made ${made}, covers everyone registered. Tick once printed.`, actions };
  },

  /** Promoting a run is what publishes it: /me reads only the active run. */
  async schedule_promoted({ db, conferenceId }) {
    const actions = [{ label: "Open Schedule Ops", href: `/admin/conference/${conferenceId}/schedule-ops` }];
    const { data: run } = await db
      .from("scheduler_runs")
      .select("started_at, activated_at, total_meetings_created")
      .eq("conference_id", conferenceId)
      .eq("run_mode", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!run) return { verdict: "not_done", detail: "No meeting schedule has been promoted yet.", actions };
    const promoted = formatDayMonth(run.activated_at ?? run.started_at, OPERATOR_TIME_ZONE) ?? "earlier";
    return {
      verdict: "done",
      detail: `Promoted ${promoted}: ${plural(run.total_meetings_created ?? 0, "meeting")}.`,
      actions,
    };
  },

  /** Seen within the last half-minute, with what is waiting for it. */
  async print_station_online({ db, conferenceId }) {
    const { stationOnline } = await import("./badges/print-station");
    const actions = [
      { label: "Open the print station", href: `/admin/conference/${conferenceId}/check-in/print-station`, print: true },
    ];
    const [{ data: stations }, { count: waiting }] = await Promise.all([
      db.from("print_stations").select("last_seen_at").eq("conference_id", conferenceId),
      db
        .from("badge_print_jobs")
        .select("id", { count: "exact", head: true })
        .eq("conference_id", conferenceId)
        .in("status", ["sent_to_printer", "rendering"]),
    ]);
    const queue = waiting ? ` ${plural(waiting, "job")} waiting.` : "";
    if (!stations || stations.length === 0) {
      return { verdict: "not_done", detail: `No print station has been set up.${queue}`, actions };
    }
    const online = stations.some((s) => stationOnline(s.last_seen_at as string | null));
    return {
      verdict: online ? "done" : "not_done",
      detail: `${online ? "Online." : "Offline: start CSC Print Station on the laptop."}${queue}`,
      actions,
    };
  },

  /** A rehearsal's check-ins must not be counted at the real doors. */
  async test_check_ins_cleared({ db, conferenceId }) {
    const actions = [
      { label: "Open the rehearsal desk", href: `/admin/conference/${conferenceId}/check-in?test=1`, print: true },
    ];
    const [people, events] = await Promise.all([
      db
        .from("conference_people")
        .select("id", { count: "exact", head: true })
        .eq("conference_id", conferenceId)
        .eq("check_in_is_test", true),
      db
        .from("conference_check_in_events")
        .select("id", { count: "exact", head: true })
        .eq("conference_id", conferenceId)
        .eq("is_test", true),
    ]);
    const n = (people.count ?? 0) + (events.count ?? 0);
    return n === 0
      ? { verdict: "done", detail: "No rehearsal check-ins are counted.", actions: [] }
      : { verdict: "not_done", detail: `${plural(n, "rehearsal check-in")} still counted. Reset the rehearsal.`, actions };
  },

  async check_in_cards_printed({ conferenceId }) {
    const actions = [
      { label: "Print check-in cards", href: `/admin/conference/${conferenceId}/check-in/cards`, print: true },
    ];
    // The count is a nicety; the button is the point. A count that fails must
    // not take the way to print with it.
    try {
      const { loadCheckInCards } = await import("./check-in-cards");
      const cards = await loadCheckInCards(conferenceId);
      const booths = cards.filter((c) => c.kind === "booth").length;
      return {
        verdict: "tick",
        detail: `${plural(booths, "booth card")} and ${plural(cards.length - booths, "event card")}.`,
        actions,
      };
    } catch {
      return { verdict: "tick", detail: "Couldn't count the cards; the sheet will show them.", actions };
    }
  },

  /** One list per capped event — the doors the desk offers on its own. */
  async door_lists_printed({ db, conferenceId }) {
    const { loadDoorEvents } = await import("./badges/checkin");
    const { doorEvents } = await loadDoorEvents(db, conferenceId);
    const capped = doorEvents.filter((e) => e.capped);
    return {
      verdict: "tick",
      detail: capped.length
        ? `${plural(capped.length, "door")}, each printed in your own name order.`
        : "No capped events have a door.",
      actions: capped.map((e) => ({
        label: e.name,
        href: `/admin/conference/${conferenceId}/check-in/door-list?entity=${e.id}`,
        print: true,
      })),
    };
  },

  async directory_printed({ conferenceId }) {
    return {
      verdict: "tick",
      detail: null,
      actions: [{ label: "Open the directory", href: `/admin/conference/${conferenceId}/directory`, print: true }],
    };
  },

  async map_printed({ conferenceId }) {
    return {
      verdict: "tick",
      detail: "The floor plan, then every booth by number and A to Z.",
      actions: [{ label: "Print the map", href: `/admin/conference/${conferenceId}/check-in/map`, print: true }],
    };
  },

  async attendee_list_printed({ conferenceId }) {
    return {
      verdict: "tick",
      detail: "Everyone registered, in your own name order.",
      actions: [
        { label: "Print the attendee list", href: `/admin/conference/${conferenceId}/check-in/door-list`, print: true },
      ],
    };
  },
};
