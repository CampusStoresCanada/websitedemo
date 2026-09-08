import type { DelegateProfile, ExhibitorProfile } from "@/lib/scheduler/types";
import { loadSeatHoldings, type SeatHolding } from "./seats";
import { offerRequiresOwnershipOfEntityIds } from "./ownership-gate";
import { resolveAccess } from "./entity-commerce";
import { grantTypesForKinds } from "./entity-obligations";
import {
  loadBlackoutListsByOrg,
  loadBlackoutListsByContact,
} from "@/lib/org/meeting-refusals";
import { loadTopChoices } from "./top-choices";
import { parseOrgCategories, primaryDepartment } from "@/lib/publication/categories";

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
  /** Seat → holder's `contacts` id, for person-grain match reads. */
  contactBySeatId: Map<string, string>;
  /** Every named registration seat, by seat id — for name/org/auth lookups. */
  seatById: Map<string, SeatHolding>;
  /** Registration types that require owning a booth, i.e. the exhibiting side. */
  exhibitingTypeIds: Set<string>;
  /**
   * WHO ASKED FOR WHOM, at the two grains it was asked at.
   *
   * ⛔ Two lookups, never one blended map. An org's pick and its delegates'
   * picks are different assertions and must be counted at different grains —
   * see lib/scheduler/objective.ts. Handing the solver one merged "did anyone
   * here want them" would make a store that sent four people four times as
   * enthusiastic as one that sent one.
   */
  topChoices: {
    /**
     * ⚠️ DIRECTIONAL, and named for it. This was `(memberOrgId, partnerOrgId)`,
     * which quietly meant only a MEMBER'S pick could ever match — a partner's
     * five were collected on the org page, stored, and read by nothing. Half the
     * signal on the floor, and mutuality unreachable, because a mutual pick is
     * only visible if both directions are askable.
     */
    orgPicked: (declaringOrgId: string, chosenOrgId: string) => boolean;
    personPicked: (declaringContactId: string, chosenOrgId: string) => boolean;
  };
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
  /**
   * ⛔ `category_buyers` IS AN ARRAY OF OBJECTS, AND WAS BEING READ AS STRINGS.
   *
   * The real shape, per member org:
   *
   *   [{ category: "Books",
   *      contact_ids: ["…a", "…b"],
   *      contact_subcategories: { "…a": ["Textbooks", "eBooks"], … } }, …]
   *
   * It went through `normalizeStringArray`, which keeps only strings — so every
   * element was filtered out and EVERY DELEGATE GOT AN EMPTY CATEGORY LIST.
   * Measured before this fix: 0 of 10 delegates had a single category. Silently,
   * because an empty array is a perfectly ordinary value.
   *
   * What was being thrown away is the richest human-stated signal on the site:
   * WHICH PERSON buys WHICH category, down to subcategory. Algonquin alone names
   * six distinct buyers — three for Books, one for Store Services, and so on.
   * Both `lib/scheduler/reasons.ts` (the "why this meeting" text) and the
   * category axis of the match have therefore been running on nothing.
   *
   * ⚠️ Kept PER CONTACT, not flattened to the org. The old code's intent was
   * org-level, and applying the whole store's category list to every attendee
   * says the receptionist buys textbooks. A person's categories are their own.
   */
  type BuyerFacts = { categories: string[]; subcategories: string[] };
  type OrgFacts = {
    primaryCategory: string | null;
    categories: string[];
    buyingCycle: string[];
    /** Contact → what THEY buy. Empty when the org names no buyers at all. */
    buyers: Map<string, BuyerFacts>;
    /** True when the org named at least one buyer anywhere. */
    namesBuyers: boolean;
  };
  const orgFacts = new Map<string, OrgFacts>();
  for (const row of orgRows ?? []) {
    const info = (row.procurement_info ?? {}) as Record<string, unknown>;
    const categoryBuyers = info.category_buyers;

    const categorySet = new Set<string>();
    const buyers = new Map<string, BuyerFacts>();
    if (Array.isArray(categoryBuyers)) {
      for (const entry of categoryBuyers) {
        if (!entry || typeof entry !== "object") continue;
        const bucket = entry as {
          category?: unknown;
          contact_ids?: unknown;
          contact_subcategories?: unknown;
        };
        const category = typeof bucket.category === "string" ? bucket.category : null;
        if (category) categorySet.add(category);

        const subsByContact = (bucket.contact_subcategories ?? {}) as Record<string, unknown>;
        for (const contactId of normalizeStringArray(bucket.contact_ids)) {
          const facts = buyers.get(contactId) ?? { categories: [], subcategories: [] };
          if (category && !facts.categories.includes(category)) facts.categories.push(category);
          for (const sub of normalizeStringArray(subsByContact[contactId])) {
            if (!facts.subcategories.includes(sub)) facts.subcategories.push(sub);
          }
          buyers.set(contactId, facts);
        }
      }
    } else if (categoryBuyers && typeof categoryBuyers === "object") {
      // Older shape: a plain { category: … } map with no people attached.
      for (const key of Object.keys(categoryBuyers as Record<string, unknown>)) categorySet.add(key);
    }
    const categories = [...categorySet];
    const cycle = typeof info.buying_cycle === "string" ? [info.buying_cycle] : normalizeStringArray(info.buying_cycle);
    orgFacts.set(row.id as string, {
      /**
       * ⚠️ Partners store PRIMARY AND SECONDARIES in this one text column,
       * comma-joined by CategoryEditor (`selected.join(", ")`), mixing category
       * and class terms — "primary" is only the first element by convention.
       * `parseOrgCategories` is what makes that legible; do not re-split it.
       */
      // ⛔ The partner's OWN first choice, resolved to a department — not
      // `departments[0]`, which is taxonomy order and ignores what they picked.
      primaryCategory: primaryDepartment(row.primary_category as string | null),
      categories,
      buyers,
      namesBuyers: buyers.size > 0,
      buyingCycle: cycle,
    });
  }

  /**
   * A PARTNER'S declared categories, through the ONE parser that already owns
   * this column — `parseOrgCategories`, which the print directory and the member
   * map both read.
   *
   * ⛔ I first hand-split this on commas here. That was a second reader of a
   * format that already had one, and it lost three things the canonical parser
   * does: it applies ALIASES (so `Men's/Unisex` matches the taxonomy's
   * `Men's / Unisex` rather than silently missing), it INFERS the department
   * from a class (an org that picked only "Caps & Gowns" still belongs under
   * "Graduation & Regalia"), and it reports what it could not recognise instead
   * of passing junk through as if it were a category.
   *
   * Departments and classes are unioned here because a match is a match at
   * either level — a buyer who declares "Books" and a partner who declares
   * "Textbooks" overlap in the way that matters.
   */
  const partnerCategoriesByOrg = new Map<string, string[]>();
  for (const row of orgRows ?? []) {
    const parsed = parseOrgCategories(row.primary_category as string | null);
    const terms = [...parsed.departments, ...parsed.classes];
    if (terms.length > 0) partnerCategoriesByOrg.set(row.id as string, terms);
  }

  const refusalOrgIds = seats.map((s) => s.organizationId).filter(Boolean);
  /**
   * TWO GRAINS OF REFUSAL, read separately because they do not mean the same
   * thing. The org list is symmetrical and binds everyone under that company;
   * a delegate's own list binds only that person's seat. Unioning them at the
   * SOURCE would silently promote one buyer's "rather not" into their whole
   * store refusing a vendor in both directions — see lib/org/meeting-refusals.
   */
  const [blackoutByOrg, blackoutByContact, choices] = await Promise.all([
    loadBlackoutListsByOrg(refusalOrgIds),
    loadBlackoutListsByContact(
      seats
        .map((s) => s.holderContactId)
        .filter((id): id is string => Boolean(id))
    ),
    loadTopChoices(conferenceId),
  ]);

  /**
   * Stated picks, split by grain and kept split.
   *
   * ⛔ NOT `indexTopChoices().chose()`. That answers "the org OR any of its
   * people", a deliberate convenience for the org page and exactly wrong here:
   * it would let one buyer's pick be counted once as their whole company's and
   * again as their own.
   */
  const orgPickedKeys = new Set<string>();
  const personPickedKeys = new Set<string>();
  for (const choice of choices) {
    if (choice.declaringContactId) {
      personPickedKeys.add(`${choice.declaringContactId}|${choice.chosenOrgId}`);
    } else {
      orgPickedKeys.add(`${choice.declaringOrgId}|${choice.chosenOrgId}`);
    }
  }

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
      buyers: new Map<string, { categories: string[]; subcategories: string[] }>(),
      namesBuyers: false,
    };

    /**
     * WHAT THIS PERSON BUYS — their own declared categories, not their store's.
     *
     * ⛔ Absent is not "everything". If the store named buyers and did not name
     * you, you are not a buyer, and an empty list is the honest answer — that is
     * the whole point of the data being per contact. The org's list is used only
     * when the store named NOBODY at all, where it is the only signal there is.
     */
    const buyerFacts = seat.holderContactId ? facts.buyers.get(seat.holderContactId) : undefined;
    const personCategories = buyerFacts
      ? buyerFacts.categories
      : facts.namesBuyers
        ? []
        : facts.categories;
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
        /**
         * A partner's declared list lives in `primary_category`, comma-joined —
         * NOT in procurement_info, which is the member-side profile. Reading
         * `facts.categories` here gave every exhibitor an empty list, so the
         * category axis had nothing on either side of the join.
         */
        secondaryCategories: partnerCategoriesByOrg.get(seat.organizationId) ?? [],
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
        categoryResponsibilities: personCategories,
        buyingTimeline: facts.buyingCycle,
        // ⚠️ Same gap as above — per-conference intent, no home yet.
        topPriorities: [],
        meetingIntent: [],
        purchasingAuthority: null,
        /**
         * THIS PERSON'S OWN picks — not their employer's.
         *
         * ⛔ The org's list is deliberately absent here. It is a fact about the
         * org and belongs on the org term of the objective, counted once for
         * the store however many of its people are in the room. Putting it on
         * every delegate is precisely the headcount inflation that had to be
         * removed from the score once already.
         */
        top5Preferences: seat.holderContactId
          ? choices
              .filter(
                (c) =>
                  c.declaringContactId === seat.holderContactId
              )
              .map((c) => c.chosenOrgId)
          : [],
        /**
         * Their company's refusals PLUS their own. The scheduler compares this
         * against exhibitor org ids either way, so a personal refusal needs no
         * new enforcement path — only a wider list for this one seat.
         *
         * ⛔ Union here, at the seat, and nowhere upstream. Their colleague's
         * seat is built from the same org list and their own contact id, so
         * one buyer opting out of a vendor leaves the next buyer's list alone.
         */
        blackoutList: [
          ...new Set([
            ...blackoutList,
            ...(seat.holderContactId ? (blackoutByContact.get(seat.holderContactId) ?? []) : []),
          ]),
        ],
      });
    }
  }

  return {
    delegates,
    exhibitors,
    notMatchable,
    /**
     * Seat → the holder's contacts id, for the person-grain match lookup.
     * Resolved by loadSeatHoldings (contact_id first — canonical_person_id has
     * no FK), so the scheduler never re-derives it.
     */
    contactBySeatId: new Map(
      seats
        .filter((seat) => seat.holderContactId)
        .map((seat) => [seat.seatId, seat.holderContactId as string] as const)
    ),
    seatById: new Map(seats.map((seat) => [seat.seatId, seat] as const)),
    exhibitingTypeIds,
    topChoices: {
      orgPicked: (declaringOrgId, chosenOrgId) =>
        orgPickedKeys.has(`${declaringOrgId}|${chosenOrgId}`),
      personPicked: (declaringContactId, chosenOrgId) =>
        personPickedKeys.has(`${declaringContactId}|${chosenOrgId}`),
    },
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
