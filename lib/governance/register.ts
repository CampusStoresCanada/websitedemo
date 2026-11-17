/**
 * Who is on the board, today.
 *
 * `governance_role_assignments` has always been the store, and it has never had
 * a reader. Nine query sites spell "the current directors" nine ways across
 * `lib/elections/service.ts` and `lib/actions/director-terms.ts`, every one of
 * them inside an election. That is why the register only ever changed when an
 * election changed it: a resignation in March had nowhere to go, because the
 * only screens that touch this table belong to a cycle that runs once a year.
 *
 * So this module is deliberately NOT under `lib/elections/`. A board outlives
 * any particular election. The election is one of the things that changes the
 * register; it is not what the register is for.
 *
 * ⛔ ADMIN CLIENT ONLY. The three `governance_*` tables have RLS enabled with
 * zero policies, so a session client reads **zero rows and reports no error**.
 * That is how the Benchmarking Committee Console once shipped showing an empty
 * committee to everybody. Every read here takes `createAdminClient()`, and
 * authorisation happens in the action or the page, never in the query.
 *
 * ⚠️ `term_end` is EXCLUSIVE throughout, matching the rest of this table and
 * `has_capability()`. A director whose term_end is 2027-01-01 holds the seat on
 * 2026-12-31 and not on 2027-01-01, so "served until" is term_end minus a day.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface RegisterTerm {
  assignmentId: string;
  personContactId: string | null;
  personProfileId: string | null;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
  termStart: string;
  /** EXCLUSIVE. Null means open-ended. */
  termEnd: string | null;
  countsTowardCap: boolean;
  /**
   * When board access begins, if it is not simply `termStart`. NULL means the
   * term's own start. See the access-window migration for why these are
   * separate facts.
   */
  accessFrom: string | null;
  /** When board access ends, EXCLUSIVE. NULL means `termEnd`. */
  accessUntil: string | null;
  electedAtElectionId: string | null;
  appointingResolution: string | null;
  notes: string | null;
  /**
   * A zero-length, non-counting row meaning "we checked, they had not served
   * before". Not a term, and must never be shown as one or counted as a seat.
   * Same test `lib/elections/service.ts` uses.
   */
  isNoServiceMarker: boolean;
}

export interface BoardRegister {
  body: {
    id: string;
    key: string;
    name: string;
    seatCount: number | null;
    minSeatCount: number | null;
  };
  asOf: string;
  /** Holding the seat on `asOf`. */
  holding: RegisterTerm[];
  /** Term starts after `asOf` — elected or appointed, not yet seated. */
  incoming: RegisterTerm[];
  /** Term already ended. */
  past: RegisterTerm[];
  /** Markers, kept out of every count above. */
  markers: RegisterTerm[];
  /**
   * Board ACCESS on `asOf` without a seat on it — incoming directors let in
   * early, outgoing ones kept on through the handover. These are exactly the
   * people the mailing list and the board space should reach and the quorum
   * count must not include, which is why they are their own list rather than
   * folded into `holding`.
   */
  withAccessNotHolding: { term: RegisterTerm; standing: AccessStanding }[];
  /** Seats on the body with nobody in them, or null when the body has no fixed size. */
  vacancies: number | null;
  /** Below the by-law floor — a real governance problem, not a tidiness one. */
  belowMinimum: boolean;
  /**
   * Who holds which office on `asOf`, by contact.
   *
   * ⚠️ Offices are ANNUAL and lapse at the AGM (By-Law Part VI S1), so this is
   * EMPTY between the meeting that ends a board year and the one where the new
   * board elects its officers. That gap is correct and must be shown as it is;
   * displaying last year's President through it is the bug.
   */
  offices: { contactId: string; office: string; assignmentId: string; heldUntil: string | null }[];
  /** The next annual general meeting on record, for defaulting an office's end. */
  nextAgmDate: string | null;
}

/**
 * The offices the board fills.
 *
 * ⛔ Lives HERE, not beside the action that writes it. `lib/actions/director-terms.ts`
 * is a `"use server"` file, and such a file may only export async functions —
 * exporting this array from there type-checks, BUILDS, and then 500s every page
 * that imports it the moment one is loaded. It did exactly that.
 *
 * It was also duplicated: the action file had its own copy and a comment calling
 * this one a mirror. A mirror is a defect; there is one list.
 */
export const OFFICE_KEYS = [
  "president",
  "vice_president",
  "secretary",
  "treasurer",
  "past_president",
] as const;

export type BoardOffice = (typeof OFFICE_KEYS)[number];

/** Office key → the words a person reads. */
export const OFFICE_LABELS: Record<BoardOffice, string> = {
  president: "President",
  vice_president: "Vice President",
  secretary: "Secretary",
  treasurer: "Treasurer",
  past_president: "Past President",
};

const SELECT =
  "id, person_contact_id, person_profile_id, organization_id, term_start, term_end, access_from, access_until, counts_toward_cap, elected_at_election_id, appointing_resolution, notes, profiles:person_profile_id(display_name), contacts:person_contact_id(first_name, last_name), organizations:organization_id(name)";

type Row = {
  id: string;
  person_contact_id: string | null;
  person_profile_id: string | null;
  organization_id: string | null;
  term_start: string;
  term_end: string | null;
  access_from: string | null;
  access_until: string | null;
  counts_toward_cap: boolean;
  elected_at_election_id: string | null;
  appointing_resolution: string | null;
  notes: string | null;
  profiles: { display_name: string | null } | null;
  contacts: { first_name: string | null; last_name: string | null } | null;
  organizations: { name: string | null } | null;
};

function nameOf(row: Row): string {
  const fromContact = [row.contacts?.first_name, row.contacts?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  // Contact first: it is the identity the nomination and the mailing list use.
  // The profile is a login, which many directors do not have.
  return fromContact || row.profiles?.display_name?.trim() || "Name not recorded";
}

function toTerm(row: Row): RegisterTerm {
  return {
    assignmentId: row.id,
    personContactId: row.person_contact_id,
    personProfileId: row.person_profile_id,
    name: nameOf(row),
    organizationId: row.organization_id,
    organizationName: row.organizations?.name ?? null,
    termStart: row.term_start,
    termEnd: row.term_end,
    accessFrom: row.access_from,
    accessUntil: row.access_until,
    countsTowardCap: row.counts_toward_cap,
    electedAtElectionId: row.elected_at_election_id,
    appointingResolution: row.appointing_resolution,
    notes: row.notes,
    isNoServiceMarker: !row.counts_toward_cap && !!row.term_end && row.term_end === row.term_start,
  };
}

/**
 * Does this term put its holder on the board on `asOf`?
 *
 * Exported and pure because this one comparison is where an off-by-one would
 * do its damage, silently: `term_end` is EXCLUSIVE, so a term ending
 * 2027-01-01 does NOT hold on 2027-01-01. Get it backwards and the register
 * reports a director for one extra day, the mailing list keeps them, and
 * nothing anywhere raises a complaint.
 */
export function holdsOn(
  term: Pick<RegisterTerm, "termStart" | "termEnd" | "isNoServiceMarker">,
  asOf: string
): boolean {
  if (term.isNoServiceMarker) return false;
  if (term.termStart > asOf) return false;
  return !term.termEnd || term.termEnd > asOf;
}

/**
 * Does this term give its holder BOARD ACCESS on `asOf`?
 *
 * ⛔ Not the same question as `holdsOn`, and the difference is the whole point
 * of the access columns. `holdsOn` answers the governance question — quorum,
 * voting, the four-term cap — and is the one that must stay strict. This
 * answers the operational one: the mailing list, the board space, the papers.
 *
 *   incoming  Jackie Nguyen is acclaimed in October for a term starting
 *             2027-01-01, and the Executive Director invites her to the board
 *             in November. `hasBoardAccessOn` → true. `holdsOn` → FALSE, and it
 *             has to be: she is not a director yet, and counting her toward the
 *             floor of seven would report a board that does not exist.
 *
 *   outgoing  Shawn Davies's term ends 2027-01-01 and he stays through the
 *             conference that follows the AGM. `hasBoardAccessOn` → true until
 *             the date the transition stamped. `holdsOn` → false from 01-01.
 *
 * ⛔ NULL coalesces to the term's own dates, so every row written before these
 * columns existed answers exactly as it did before.
 *
 * A no-service marker grants nothing: it is a statement that somebody has NOT
 * served, not a term, and it must never put anyone on a mailing list.
 */
export function hasBoardAccessOn(
  term: Pick<
    RegisterTerm,
    "termStart" | "termEnd" | "accessFrom" | "accessUntil" | "isNoServiceMarker"
  >,
  asOf: string
): boolean {
  if (term.isNoServiceMarker) return false;
  const from = term.accessFrom ?? term.termStart;
  const until = term.accessUntil ?? term.termEnd;
  if (from > asOf) return false;
  return !until || until > asOf;
}

/**
 * Why somebody has board access, in the words the screens use.
 *
 * Derived, never stored — a stored status is a second source of truth that
 * someone has to remember to flip, and the dates already say it.
 */
export type AccessStanding = "holding" | "incoming" | "outgoing" | "none";

export function accessStandingOn(
  term: Pick<
    RegisterTerm,
    "termStart" | "termEnd" | "accessFrom" | "accessUntil" | "isNoServiceMarker"
  >,
  asOf: string
): AccessStanding {
  if (holdsOn(term, asOf)) return "holding";
  if (!hasBoardAccessOn(term, asOf)) return "none";
  // Access without the seat: before it starts, or after it ended.
  return term.termStart > asOf ? "incoming" : "outgoing";
}

/**
 * The board as at a date.
 *
 * `asOf` is a parameter rather than "now" so the screen can answer "what does
 * this look like on the day the new terms start" — which is the question
 * somebody actually has in December, and the one the mailing list press asks.
 */
export async function loadBoardRegister(input: {
  bodyKey?: string;
  bodyId?: string;
  asOf: string;
  roleKey?: string;
}): Promise<BoardRegister | null> {
  const db = createAdminClient();
  const roleKey = input.roleKey ?? "director";

  let bodyQuery = db
    .from("governance_bodies")
    .select("id, key, name, seat_count, min_seat_count");
  bodyQuery = input.bodyId
    ? bodyQuery.eq("id", input.bodyId)
    : bodyQuery.eq("key", input.bodyKey ?? "board_of_directors");

  const { data: body } = await bodyQuery.maybeSingle();
  if (!body) return null;

  const { data: rows } = await db
    .from("governance_role_assignments")
    .select(SELECT)
    .eq("body_id", body.id as string)
    .eq("role_key", roleKey)
    .order("term_start", { ascending: false });

  const holding: RegisterTerm[] = [];
  const incoming: RegisterTerm[] = [];
  const past: RegisterTerm[] = [];
  const markers: RegisterTerm[] = [];
  const withAccessNotHolding: { term: RegisterTerm; standing: AccessStanding }[] = [];

  for (const raw of (rows ?? []) as unknown as Row[]) {
    const term = toTerm(raw);
    if (term.isNoServiceMarker) {
      markers.push(term);
      continue;
    }
    if (holdsOn(term, input.asOf)) {
      holding.push(term);
      continue;
    }
    // Not a seat, but possibly still access. Both lists matter: `incoming` and
    // `past` are about the TERM, this is about the door.
    const standing = accessStandingOn(term, input.asOf);
    if (standing === "incoming" || standing === "outgoing")
      withAccessNotHolding.push({ term, standing });
    if (term.termStart > input.asOf) incoming.push(term);
    else past.push(term);
  }

  holding.sort((a, b) => a.name.localeCompare(b.name));
  incoming.sort((a, b) => a.termStart.localeCompare(b.termStart) || a.name.localeCompare(b.name));

  // Offices live on the same body as their own assignments, with their own
  // dates. Read separately because they answer a different question from the
  // seat and must be allowed to be absent.
  const { data: officeRows } = await db
    .from("governance_role_assignments")
    .select("id, person_contact_id, role_key, term_start, term_end")
    .eq("body_id", body.id as string)
    .in("role_key", OFFICE_KEYS as unknown as string[]);

  const offices = (officeRows ?? [])
    .filter((o) => {
      const start = o.term_start as string;
      const end = o.term_end as string | null;
      return start <= input.asOf && (!end || end > input.asOf);
    })
    .map((o) => ({
      contactId: o.person_contact_id as string,
      office: o.role_key as string,
      assignmentId: o.id as string,
      heldUntil: o.term_end as string | null,
    }));

  const { data: agm } = await db
    .from("board_meetings")
    .select("meeting_date")
    .eq("meeting_type", "agm")
    .gte("meeting_date", input.asOf)
    .order("meeting_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  const seatCount = (body.seat_count as number | null) ?? null;
  const minSeatCount = (body.min_seat_count as number | null) ?? null;

  return {
    body: {
      id: body.id as string,
      key: body.key as string,
      name: body.name as string,
      seatCount,
      minSeatCount,
    },
    asOf: input.asOf,
    holding,
    incoming,
    past,
    markers,
    withAccessNotHolding,
    vacancies: seatCount === null ? null : Math.max(0, seatCount - holding.length),
    belowMinimum: minSeatCount !== null && holding.length < minSeatCount,
    offices,
    nextAgmDate: (agm?.meeting_date as string | null) ?? null,
  };
}
