import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Standing refusals to meet.
 *
 * A refusal is a human relationship fact, not a computed one — see
 * `lib/scheduler/blackout.ts` for why enforcement never reads a score. This
 * module is the only place that loads them, so there is one answer to "who
 * refuses whom" rather than one per consumer.
 *
 * ⛔ TWO GRAINS, ONE TABLE. `declaring_contact_id` null means the ORG is
 * refusing; set means ONE DELEGATE is. That is a different subject making the
 * same kind of statement, not a different kind of statement — the same reason
 * `conference_top_choices` carries both, and the same convention
 * `match_edges.subject_contact_id` uses.
 *
 * ⛔ The two grains do NOT behave alike, and conflating them is the trap:
 * an ORG refusal is symmetrical (either side may fire the other, so the pair is
 * blacked out both ways), while a PERSON refusal binds only that person. Their
 * colleague may still want the meeting, their company has refused nothing, and
 * the vendor has certainly not refused the company. Folding a person's row into
 * an org list would let one buyer silently speak for everyone they work with.
 *
 * ⚠️ Reads go through the admin client. The table has RLS enabled with no
 * policies, so a session client returns zero rows and a null error — which
 * reads as "nobody refuses anybody" rather than as a failure.
 */

/** How long a refusal may go unreaffirmed before review should flag it. */
export const REFUSAL_REAFFIRM_INTERVAL_DAYS = 365;

/**
 * Shape of a live refusal row.
 *
 * Declared locally rather than pulled from `lib/database.types.ts` because that
 * file is shared and currently carries other sessions' changes — regenerating it
 * to pick up this one table would be a merge decision, not a type fix. Delete
 * this and use the generated Row type at the next coordinated regen.
 */
type RefusalRow = {
  declaring_org_id: string;
  /** Whose refusal. Null = the org's own; set = one delegate's. */
  declaring_contact_id: string | null;
  refused_org_id: string;
  reason: string | null;
  first_declared_at: string;
  reaffirmed_at: string | null;
};

/** Every refusal still in force. Low cardinality by nature — these are rare,
 *  deliberate declarations, so one read and an in-memory filter beats a
 *  per-org query and keeps the callers honest about cost. */
async function loadLiveRefusals(): Promise<RefusalRow[]> {
  // The generated types don't know this table yet (see RefusalRow above), so the
  // query builder can't type the chain. Narrow shim rather than a blanket
  // ts-expect-error: it states exactly what this one call returns, and it stops
  // compiling the moment someone changes the shape.
  const db = createAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        is: (
          column: string,
          value: null
        ) => Promise<{ data: RefusalRow[] | null; error: { message: string } | null }>;
      };
    };
  };
  const { data, error } = await db
    .from("org_meeting_refusals")
    .select(
      "declaring_org_id, declaring_contact_id, refused_org_id, reason, first_declared_at, reaffirmed_at"
    )
    .is("retired_at", null);

  // Never swallow this. An unreadable refusal list is not an empty one, and
  // treating it as empty would schedule exactly the meetings this prevents.
  if (error) {
    throw new Error(`Could not load meeting refusals: ${error.message}`);
  }
  return data ?? [];
}

export type StaleRefusal = {
  declaringOrgId: string;
  /** Set when this is one person's refusal rather than their company's. */
  declaringContactId: string | null;
  refusedOrgId: string;
  reason: string | null;
  /** Last reaffirmation, or the original declaration if never reaffirmed. */
  lastConfirmedAt: string;
};

/**
 * Blackout lists keyed by org id, covering both directions.
 *
 * An ORG refusal is symmetrical in effect: if A refuses B, then B's list
 * contains A too, so whichever side a caller looks the pair up from it gets the
 * same answer. This is what feeds `BlackoutParty.blackoutList`.
 *
 * ⛔ ORG-GRAIN ROWS ONLY. A delegate's personal refusal is deliberately absent
 * here — including it would black the pair out for the whole company in both
 * directions, which is three claims nobody made. Those are read per person by
 * `loadBlackoutListsByContact`.
 *
 * Returns an entry only for orgs that actually appear in a refusal. Callers
 * should treat a missing key as an empty list, not as an error.
 */
export async function loadBlackoutListsByOrg(
  orgIds: string[]
): Promise<Map<string, string[]>> {
  const byOrg = new Map<string, string[]>();
  const wanted = new Set(orgIds.filter(Boolean));
  if (wanted.size === 0) return byOrg;

  const rows = (await loadLiveRefusals()).filter((row) => row.declaring_contact_id === null);

  const add = (org: string, refused: string) => {
    const list = byOrg.get(org) ?? [];
    if (!list.includes(refused)) list.push(refused);
    byOrg.set(org, list);
  };

  for (const row of rows) {
    // Both directions: the declaring org refuses, and the refused org is
    // equally unmeetable from the other side.
    if (wanted.has(row.declaring_org_id)) add(row.declaring_org_id, row.refused_org_id);
    if (wanted.has(row.refused_org_id)) add(row.refused_org_id, row.declaring_org_id);
  }

  return byOrg;
}

/**
 * Blackout lists keyed by CONTACT id — one delegate's own refusals.
 *
 * ⛔ ONE DIRECTION ONLY, unlike the org version. "I would rather not sit with
 * them" is a statement about where this person may be seated. It says nothing
 * about the vendor's willingness, nothing about this person's colleagues, and
 * nothing about their employer — so there is no second direction to mirror and
 * no org to fold it into.
 *
 * Callers union the result into that delegate's `blackoutList`, which the
 * scheduler already compares against exhibitor org ids.
 */
export async function loadBlackoutListsByContact(
  contactIds: string[]
): Promise<Map<string, string[]>> {
  const byContact = new Map<string, string[]>();
  const wanted = new Set(contactIds.filter(Boolean));
  if (wanted.size === 0) return byContact;

  for (const row of await loadLiveRefusals()) {
    const contactId = row.declaring_contact_id;
    if (!contactId || !wanted.has(contactId)) continue;
    const list = byContact.get(contactId) ?? [];
    if (!list.includes(row.refused_org_id)) list.push(row.refused_org_id);
    byContact.set(contactId, list);
  }

  return byContact;
}

/**
 * Live refusals that have not been reaffirmed within the interval.
 *
 * These are STILL ENFORCED. This list exists so an admin can retire them
 * deliberately before a schedule run, not so the system can quietly stop
 * honouring them — a refusal must never lapse into permission because nobody
 * clicked a button.
 *
 * Both grains appear, tagged by `declaringContactId`, because a person's
 * refusal goes stale exactly the way a company's does — and reviewing "Store X
 * will not meet Vendor V" without knowing it was one buyer three years ago is
 * how a review reaches the wrong answer confidently.
 */
export async function listStaleRefusals(
  now: Date = new Date()
): Promise<StaleRefusal[]> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - REFUSAL_REAFFIRM_INTERVAL_DAYS);

  const stale: StaleRefusal[] = [];
  for (const row of await loadLiveRefusals()) {
    const lastConfirmedAt = row.reaffirmed_at ?? row.first_declared_at;
    if (new Date(lastConfirmedAt) > cutoff) continue;
    stale.push({
      declaringOrgId: row.declaring_org_id,
      declaringContactId: row.declaring_contact_id,
      refusedOrgId: row.refused_org_id,
      reason: row.reason,
      lastConfirmedAt,
    });
  }
  return stale;
}
