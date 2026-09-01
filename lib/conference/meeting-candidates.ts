import type { DelegateProfile, ExhibitorProfile } from "@/lib/scheduler/types";
import { loadSeatHoldings, type SeatHolding } from "./seats";
import { offerRequiresOwnershipOfEntityIds } from "./ownership-gate";
import { resolveAccess } from "./entity-commerce";
import { grantTypesForKinds } from "./entity-obligations";
import { loadBlackoutListsByOrg } from "@/lib/org/meeting-refusals";

/**
 * The one place that answers "who can be scheduled, and what do we know about
 * them" — for the scheduler AND for swaps.
 *
 * Both used to build solver profiles themselves, from conference_registrations,
 * with their own copy of the row→profile mapping. That is the same duplication
 * the seat reader and the `includes` declaration were built to end, one layer
 * down: two candidate lists that could disagree about who is coming.
 */
export type MeetingCandidates = {
  delegates: DelegateProfile[];
  exhibitors: ExhibitorProfile[];
  /** Named seats on neither side — reported, never swept onto one of them. */
  notMatchable: string[];
  /** Every named registration seat, by seat id — for name/org/auth lookups. */
  seatById: Map<string, SeatHolding>;
  /** Registration types that require owning a booth, i.e. the exhibiting side. */
  exhibitingTypeIds: Set<string>;
};

type CandidateDb = Parameters<typeof loadSeatHoldings>[0] & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

export async function loadMeetingCandidates(
  db: CandidateDb,
  conferenceId: string
): Promise<MeetingCandidates> {
  /**
   * WHO IS COMING = a named seat. Not a row in conference_registrations.
   *
   * That table has 0 rows, 68 columns and no writer anywhere — not in app code,
   * not in a DB function. It is the v2 person-monolith (delegate_name,
   * dietary_restrictions, hotel_name, badge_print_status, blackout_list), and v3
   * split every one of those out. So this function used to ask a dead table who
   * was coming, get nobody, and raise INSUFFICIENT_ACTIVE_REGISTRATIONS while
   * people sat named on seats the whole time.
   *
   * `entity_balance_seats` is FK-enforced to conference_people and allocateSeat
   * is its only writer, so the seat IS the fact. loadSeatHoldings is the one
   * reader (lib/conference/seats.ts).
   */
  const { seats, entitiesById } = await loadSeatHoldings(db, {
    conferenceId,
    entityKinds: ["registration"],
    assigned: true,
  });

  /**
   * Which side of the table someone sits on is a property of the TYPE they
   * hold: an exhibiting registration `requires_ownership_of` a booth. Same
   * structural test the badge pipeline uses. The old code compared
   * `registration_type` to the string literals "delegate"/"observer"/"exhibitor"
   * — the v2 role model, which cannot describe a conference that sells a third
   * kind of attendee.
   */
  const exhibitingTypeIds = new Set<string>();
  for (const entity of entitiesById.values()) {
    if (entity.kind !== "registration") continue;
    const requires = offerRequiresOwnershipOfEntityIds(entity.refs);
    if (requires.some((id) => entitiesById.get(id)?.kind === "booth")) {
      exhibitingTypeIds.add(entity.id);
    }
  }

  const orgIds = [...new Set(seats.map((s) => s.organizationId).filter(Boolean))];

  const { data: orgRows } = await db
    .from("organizations")
    .select("id, primary_category, procurement_info")
    .in("id", orgIds.length > 0 ? orgIds : ["00000000-0000-0000-0000-000000000000"]);

  /**
   * Match signal comes from the ORG's standing procurement profile, not from a
   * per-conference form.
   *
   * This is the precedent already set in this file for blackout lists, which
   * were moved to org_meeting_refusals because a per-registration column meant
   * "a refusal expired every year unless someone retyped it". The same is true
   * of what a store buys and when it buys it.
   */
  type OrgFacts = { primaryCategory: string | null; categories: string[]; buyingCycle: string[] };
  const orgFacts = new Map<string, OrgFacts>();
  for (const row of orgRows ?? []) {
    const info = (row.procurement_info ?? {}) as Record<string, unknown>;
    const categoryBuyers = info.category_buyers;
    const categories = Array.isArray(categoryBuyers)
      ? normalizeStringArray(categoryBuyers)
      : categoryBuyers && typeof categoryBuyers === "object"
        ? Object.keys(categoryBuyers as Record<string, unknown>)
        : [];
    const cycle = typeof info.buying_cycle === "string" ? [info.buying_cycle] : normalizeStringArray(info.buying_cycle);
    orgFacts.set(row.id as string, {
      primaryCategory: (row.primary_category as string | null) ?? null,
      categories,
      buyingCycle: cycle,
    });
  }

  const refusalOrgIds = seats.map((s) => s.organizationId).filter(Boolean);
  const blackoutByOrg = await loadBlackoutListsByOrg(refusalOrgIds);

  const delegates: DelegateProfile[] = [];
  const exhibitors: ExhibitorProfile[] = [];
  /** Named seats whose type is in no meeting at all — CSC staff, a $4,000 booth. */
  const notMatchable: string[] = [];

  /**
   * Is this registration in the curated meetings? `meeting_access` says so.
   *
   * `ENTITY_KIND_TO_GRANT_TYPES` already declares `meeting: ["meeting_access"]`
   * — the grant vocabulary built for badges and data obligations — and
   * `grantTypesForKinds` is its reader, already used by person-agenda.ts. So the
   * question is simply: does the access graph reach an entity of kind `meeting`.
   *
   * ⛔ I got here the long way, and every wrong turn was an invention:
   *   1. "not an exhibitor means a delegate" — put three CSC staff, the
   *      association that RUNS the conference, into supplier meetings as buyers
   *   2. `organizations.type === "Member"` — a hardcode of a CSC-CONFIGURED
   *      value (MembershipProgramDef maps org type to permission level)
   *   3. `summarizeAccess().meetingDay` — true for anything on the meeting DAY,
   *      and Tuesday also holds "Get Organized"; let all three straight back in
   *   4. matching a session's start/end against the day's meeting windows — a
   *      parser trick whose only purpose was to work around the Meeting Blocks
   *      being stored as kind `session`, when the catalogue has had a `meeting`
   *      kind all along: "A scheduled meeting slot — buyer/seller, board,
   *      committee."
   *
   * The miskinded data was the bug. Those four were me routing around it
   * instead of reading what had already been built.
   */
  const meetingParticipationByTypeId = new Map<string, boolean>();
  const participatesInMeetings = (entityId: string): boolean => {
    const cached = meetingParticipationByTypeId.get(entityId);
    if (cached !== undefined) return cached;
    const reachableKinds = [...resolveAccess([entityId], entitiesById)]
      .map((id) => entitiesById.get(id)?.kind)
      .filter((kind): kind is string => Boolean(kind));
    const participates = grantTypesForKinds(reachableKinds).includes("meeting_access");
    meetingParticipationByTypeId.set(entityId, participates);
    return participates;
  };

  for (const seat of seats) {
    const userId = seat.holderUserId ?? "";
    const facts = orgFacts.get(seat.organizationId) ?? {
      primaryCategory: null,
      categories: [],
      buyingCycle: [],
    };
    const blackoutList = blackoutByOrg.get(seat.organizationId) ?? [];

    /**
     * IS THIS PERSON IN MEETINGS? The graph already says so — ask it.
     *
     * `resolveAccess` walks `includes` AND `involved_in`, and the catalogue
     * records meeting participation on the second of those:
     *
     *   Board Registration            --involved_in--> Meeting Block 1..5
     *   Full Conference Registration  --involved_in--> Meeting Block 1..5
     *   Tuesday Day Pass              --involved_in--> Meeting Block 1..5
     *   Connected Exhibitor Staff Reg --involved_in--> Meeting Block 1..5
     *
     * ⛔ I twice reached for something else — first "not an exhibitor means a
     * delegate", then `organizations.type` — and both were inventions. The first
     * scheduled three Campus Stores Canada staff, the association that RUNS the
     * conference, into supplier meetings as buyers. Staff Registration is
     * involved_in nothing, so the graph had already excluded them. So had it
     * excluded the $4,000 Exhibitor Staff Registration, while including the
     * Connected tier — the ED's "$4000 booths shouldn't get meetings" was
     * declared data before it was ever a rule in code.
     *
     * WHICH SIDE they sit on is the separate, already-solved question:
     * ownership-gate's "does this type require owning a booth".
     */
    if (!participatesInMeetings(seat.entityId)) {
      notMatchable.push(seat.seatId);
      continue;
    }

    if (exhibitingTypeIds.has(seat.entityId)) {
      exhibitors.push({
        registrationId: seat.seatId,
        organizationId: seat.organizationId,
        userId,
        primaryCategory: facts.primaryCategory,
        secondaryCategories: facts.categories,
        /**
         * ⚠️ NO CANONICAL HOME YET. buying_cycles_targeted, meeting_outcome_intent
         * and sales_readiness were per-conference intent columns on the v2
         * monolith. They are not derivable from anything we hold, so they come
         * through empty and the scorer falls back to category overlap.
         *
         * ⛔ The fix is NOT to restore those columns. It is one collection
         * surface for per-conference intent, attached to the seat — the same
         * argument that produced this port.
         */
        buyingCyclesTargeted: [],
        meetingOutcomeIntent: [],
        salesReadiness: null,
        blackoutList,
      });
    } else {
      delegates.push({
        registrationId: seat.seatId,
        organizationId: seat.organizationId,
        userId,
        categoryResponsibilities: facts.categories,
        buyingTimeline: facts.buyingCycle,
        // ⚠️ Same gap as above — per-conference intent, no home yet.
        topPriorities: [],
        meetingIntent: [],
        purchasingAuthority: null,
        top5Preferences: [],
        blackoutList,
      });
    }
  }

  return {
    delegates,
    exhibitors,
    notMatchable,
    seatById: new Map(seats.map((seat) => [seat.seatId, seat] as const)),
    exhibitingTypeIds,
  };
}

/**
 * Other seats the same person is named to. Replaces
 * `conference_registrations.linked_registration_id`, which was a hand-kept
 * pointer at a second registration so a paired attendee would not be booked
 * into both meetings at once. Two seats held by one person say that already.
 */
export function siblingSeatIds(seatId: string, seats: Iterable<SeatHolding>): string[] {
  const all = [...seats];
  const self = all.find((s) => s.seatId === seatId);
  if (!self?.holderPersonId) return [];
  return all
    .filter((s) => s.seatId !== seatId && s.holderPersonId === self.holderPersonId)
    .map((s) => s.seatId);
}
