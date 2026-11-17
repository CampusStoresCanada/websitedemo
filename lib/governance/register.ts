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
  /** Seats on the body with nobody in them, or null when the body has no fixed size. */
  vacancies: number | null;
  /** Below the by-law floor — a real governance problem, not a tidiness one. */
  belowMinimum: boolean;
}

const SELECT =
  "id, person_contact_id, person_profile_id, organization_id, term_start, term_end, counts_toward_cap, elected_at_election_id, appointing_resolution, notes, profiles:person_profile_id(display_name), contacts:person_contact_id(first_name, last_name), organizations:organization_id(name)";

type Row = {
  id: string;
  person_contact_id: string | null;
  person_profile_id: string | null;
  organization_id: string | null;
  term_start: string;
  term_end: string | null;
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

  for (const raw of (rows ?? []) as unknown as Row[]) {
    const term = toTerm(raw);
    if (term.isNoServiceMarker) {
      markers.push(term);
      continue;
    }
    if (holdsOn(term, input.asOf)) holding.push(term);
    else if (term.termStart > input.asOf) incoming.push(term);
    else past.push(term);
  }

  holding.sort((a, b) => a.name.localeCompare(b.name));
  incoming.sort((a, b) => a.termStart.localeCompare(b.termStart) || a.name.localeCompare(b.name));

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
    vacancies: seatCount === null ? null : Math.max(0, seatCount - holding.length),
    belowMinimum: minSeatCount !== null && holding.length < minSeatCount,
  };
}
