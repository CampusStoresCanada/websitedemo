import { readMatchEdges } from "@/lib/match/read";
import type { MatchScoreRecord } from "@/lib/scheduler/types";

/**
 * The conference solver's view of match quality: (member org, partner org) → total.
 *
 * ⛔ READ THE PROMOTED TABLE, NOT THE SCORER. `matchTotal(scorePair(...))` still
 * works, but calling it live rebuilds every MatchProfile on every solve, and the
 * nightly run has already derived them. `match_edges` on the promoted run IS the
 * answer, and `total` IS `matchTotal` — fit discounted by coverage.
 *
 * ⚠️ A MISSING ROW MEANS ZERO, NOT UNKNOWN. The engine drops edges that score 0
 * (they were half of everything, and a stored zero reads like a considered
 * answer) and keeps the top 50 per subject. So absence is a real answer and this
 * returns 0 for it — never null, never "skip this pairing".
 *
 * ⛔ A SCORE MAY NEVER DECIDE WHO MEETS WHOM. Not who does, and not who doesn't.
 * Refusals come from `org_meeting_refusals` and are applied as a legality filter
 * before anything here is consulted; the engine has no blocklist input at all,
 * and `generate.ts` deliberately ignores any `isBlackout` on a score record.
 * There is a regression test that hands the solver a refused pair scoring 100 and
 * asserts the meeting still does not happen.
 */

export type MeetingMatchScores = {
  /**
   * Member ORG → partner org. Missing = 0, and that is EXACT: on the promoted
   * run every pair was computed and every nonzero one stored (the top-50 cap
   * never bound), so absence means computed-and-scored-zero.
   */
  orgTotalFor: (memberOrgId: string, partnerOrgId: string) => number;
  /**
   * Member CONTACT → partner org, additive on top of the org prior.
   *
   * ⚠️ Missing here means NEVER COMPUTED AT PERSON GRAIN — unknown, not zero.
   * That is why it is a separate additive term and not a fallback: person
   * absence must add nothing, never assert no-affinity.
   *
   * Buyer↔COMPANY by design, not buyer↔rep. CSC does not staff a partner's
   * suite, so which rep works the booth is not ours to optimize over.
   */
  personTotalFor: (memberContactId: string, partnerOrgId: string) => number;
  /**
   * The engine's per-axis values for a store pair, for explanation only.
   * ⛔ null in here means the axis never had anything to say — never collapse it
   * to 0, or a UI will report a judgement nobody made.
   */
  breakdownFor: (memberOrgId: string, partnerOrgId: string) => Record<string, number | null>;
  /** The engine's own reason sentences for a store pair. */
  reasonsFor: (memberOrgId: string, partnerOrgId: string) => string[];
  /** Position within this subject's candidates; large when there is no edge. */
  rankFor: (memberOrgId: string, partnerOrgId: string) => number;
  /** Whether a promoted run existed at all — null engine vs a genuinely empty one. */
  /** Every org-grain total on this run — the distribution, not one pair. */
  orgTotals: number[];
  available: boolean;
  edgeCount: number;
  personEdgeCount: number;
};

const NO_RANK = Number.MAX_SAFE_INTEGER;

const EMPTY: MeetingMatchScores = {
  orgTotalFor: () => 0,
  personTotalFor: () => 0,
  breakdownFor: () => ({}),
  reasonsFor: () => [],
  rankFor: () => NO_RANK,
  // No run, no distribution — so no calibrated weight either. Picks contribute
  // nothing rather than a number nobody chose.
  orgTotals: [],
  available: false,
  edgeCount: 0,
  personEdgeCount: 0,
};

/**
 * Load the member→partner edges for the orgs actually in this conference.
 *
 * One read per member org rather than a table scan, because `readMatchEdges` is
 * the canonical reader and applies the `subject_contact_id IS NULL` filter that
 * keeps an org-level read from multiplying each candidate by however many buyers
 * that org happens to name once person-level edges exist (they are all NULL
 * today, which is exactly when it is cheapest to get this wrong).
 */
export async function loadMeetingMatchScores(
  memberOrgIds: readonly string[],
  /** Delegates as (contact, their org) — readMatchEdges keys person reads by both. */
  memberContacts: ReadonlyArray<{ contactId: string; orgId: string }> = []
): Promise<MeetingMatchScores> {
  const uniqueMembers = [...new Set(memberOrgIds.filter(Boolean))];
  if (uniqueMembers.length === 0) return EMPTY;

  const byPair = new Map<string, number>();
  const detailByPair = new Map<
    string,
    { breakdown: Record<string, number | null>; reasons: string[]; rank: number }
  >();
  let sawARun = false;
  let edgeCount = 0;

  for (const memberOrgId of uniqueMembers) {
    const edges = await readMatchEdges({
      subjectOrgId: memberOrgId,
      direction: "member_to_partner",
    });
    // null = no promoted run / engine unavailable. An empty array is a real
    // answer: this member genuinely matched nothing.
    if (edges === null) continue;
    sawARun = true;
    for (const edge of edges) {
      const key = `${memberOrgId}|${edge.candidateOrgId}`;
      byPair.set(key, edge.total);
      detailByPair.set(key, {
        breakdown: edge.breakdown,
        reasons: edge.reasons.map((r) => r.text),
        rank: edge.rank,
      });
      edgeCount += 1;
    }
  }

  /**
   * Person edges, read at person grain.
   *
   * There are none today — subject_contact_id is null on every row — so these
   * reads return empty and the term contributes 0. That is deliberate: the day
   * the engine starts emitting them this sharpens on its own, with nobody
   * remembering to come back here. A hardcoded zero would not.
   *
   * ⚠️ NOT a fallback for a missing org edge. Missing here means never computed
   * at this grain; missing at org grain means computed and scored zero. Two
   * different facts, so two additive terms.
   */
  const byPerson = new Map<string, number>();
  let personEdgeCount = 0;
  const seenContacts = new Set<string>();

  for (const contact of memberContacts) {
    if (!contact.contactId || !contact.orgId) continue;
    if (seenContacts.has(contact.contactId)) continue;
    seenContacts.add(contact.contactId);

    const edges = await readMatchEdges({
      subjectOrgId: contact.orgId,
      subjectContactId: contact.contactId,
      direction: "member_to_partner",
    });
    if (edges === null) continue;
    for (const edge of edges) {
      byPerson.set(`${contact.contactId}|${edge.candidateOrgId}`, edge.total);
      personEdgeCount += 1;
    }
  }

  return {
    orgTotalFor: (memberOrgId, partnerOrgId) => byPair.get(`${memberOrgId}|${partnerOrgId}`) ?? 0,
    breakdownFor: (memberOrgId, partnerOrgId) =>
      detailByPair.get(`${memberOrgId}|${partnerOrgId}`)?.breakdown ?? {},
    reasonsFor: (memberOrgId, partnerOrgId) =>
      detailByPair.get(`${memberOrgId}|${partnerOrgId}`)?.reasons ?? [],
    rankFor: (memberOrgId, partnerOrgId) =>
      detailByPair.get(`${memberOrgId}|${partnerOrgId}`)?.rank ?? NO_RANK,
    personTotalFor: (memberContactId, partnerOrgId) =>
      byPerson.get(`${memberContactId}|${partnerOrgId}`) ?? 0,
    available: sawARun,
    edgeCount,
    personEdgeCount,
    /**
     * Every org-grain total on this run, for callers that need the SHAPE of the
     * distribution rather than one pair's value.
     *
     * ⛔ Exists because a constant in score units is a trap: `total` is becoming
     * a per-run percentile, so any threshold or weight fitted to one night's
     * numbers silently re-scales on the next. Anything tuned against scores must
     * be computed from the run it is scheduling — see preferenceWeightFromTotals.
     */
    orgTotals: [...byPair.values()],
  };
}


/**
 * ONE SCORE SOURCE for the whole meeting pipeline.
 *
 * The greedy seed, the local search and the swap alternatives were each ranking
 * on a different notion of a good match: the greedy on the v2
 * `computeAllMatchScores`, the search on `match_edges`, and swaps on persisted
 * v2 rows. A meeting could be created by one idea of a good pairing, improved by
 * a second and swapped by a third, none of which agreed. This is the single
 * source they all read.
 *
 * PAIR score = orgTotal(delegate's store, vendor) + personTotal(delegate, vendor).
 *
 * ⚠️ That is the value ONE DELEGATE brings, and it is deliberately not the
 * meeting total. The objective de-duplicates the org term across a room (an org
 * edge is a claim about an org pair, counted once however many of their people
 * are present); ranking a single delegate has no room to de-duplicate against.
 * Two colleagues from one store rank equally on org grounds, which is correct —
 * they are equally good on what we know about their employer.
 *
 * ⛔ `isBlackout` is always false. Legality is decided from
 * `org_meeting_refusals` before any score is consulted, the engine has no
 * blocklist input, and generate.ts ignores this field by design. It survives
 * only because the record shape is shared.
 */
export function toSolverRecords(params: {
  delegates: ReadonlyArray<{ registrationId: string; organizationId: string }>;
  exhibitors: ReadonlyArray<{ registrationId: string; organizationId: string }>;
  contactBySeatId: ReadonlyMap<string, string>;
  scores: MeetingMatchScores;
}): MatchScoreRecord[] {
  const records: MatchScoreRecord[] = [];
  for (const delegate of params.delegates) {
    const contactId = params.contactBySeatId.get(delegate.registrationId);
    for (const exhibitor of params.exhibitors) {
      const org = params.scores.orgTotalFor(delegate.organizationId, exhibitor.organizationId);
      const person = contactId
        ? params.scores.personTotalFor(contactId, exhibitor.organizationId)
        : 0;
      records.push({
        delegateSeatId: delegate.registrationId,
        exhibitorSeatId: exhibitor.registrationId,
        exhibitorOrganizationId: exhibitor.organizationId,
        totalScore: org + person,
        breakdown: params.scores.breakdownFor(delegate.organizationId, exhibitor.organizationId),
        reasons: params.scores.reasonsFor(delegate.organizationId, exhibitor.organizationId),
        isBlackout: false,
        isTop5: params.scores.rankFor(delegate.organizationId, exhibitor.organizationId) <= 5,
      });
    }
  }
  return records;
}
