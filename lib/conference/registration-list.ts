import { selectInChunks } from "@/lib/supabase/select-in-chunks";
import { declinedSeatIds, loadSeatHoldings, loadUsageIntents } from "@/lib/conference/seats";
import { deriveRegistrationTier } from "@/lib/conference/registration-tier";
import { isFundedOffer } from "@/lib/conference/entity-pricing";

/**
 * Who is registered: every registration seat of a conference, for the admin
 * Registrations screen.
 *
 * Not a new answer. The seats are loadSeatHoldings' (the one reader of who
 * holds what), and which side of the floor a registration is on is
 * deriveRegistrationTier, the same rule the badge prints from, so this list
 * and the badges cannot disagree about who is an exhibitor.
 */
export type RegistrationSide = "delegate" | "exhibitor";

/**
 * Which badge the person wears, by the colour of its overlay: delegate red,
 * exhibitor blue, CSC staff white (Steve, 2026-11-24). Staff are told apart by
 * their organization's type, the same way resolveConferenceTier does it.
 */
export type BadgeColour = "delegate" | "exhibitor" | "staff";

export type RegistrationListSeat = {
  seatId: string;
  organizationId: string;
  organizationName: string;
  /** A test organization: listed and marked, left out of every count. */
  isTestOrg: boolean;
  side: RegistrationSide;
  badge: BadgeColour;
  registrationName: string;
  /** Someone else pays for it (the CANCOLL-funded registration). */
  funded: boolean;
  /** Null: the seat is bought and nobody is named to it yet. */
  holderPersonId: string | null;
  holderName: string | null;
  /** From the person's conference record; null when they have not given one. */
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  /**
   * An unnamed seat the organization has said it will not fill ("using 2 of
   * 6"). Still paid for and still nameable at the desk; not somebody to expect.
   */
  declined: boolean;
  seatedAt: string | null;
};

type ListDb = Parameters<typeof loadSeatHoldings>[0];

export async function loadRegistrationList(db: ListDb, conferenceId: string): Promise<RegistrationListSeat[]> {
  const [{ seats, entitiesById }, intents] = await Promise.all([
    loadSeatHoldings(db, { conferenceId, entityKinds: ["registration"] }),
    loadUsageIntents(db, conferenceId),
  ]);
  const declined = declinedSeatIds(seats, intents);

  const orgIds = [...new Set(seats.map((s) => s.organizationId).filter(Boolean))];
  const { data: orgs, error } = orgIds.length
    ? await selectInChunks<{ id: string; name: string; type: string | null; is_test: boolean | null }>(orgIds, (ids) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the seat reader's structural client
        (db as any).from("organizations").select("id, name, type, is_test").in("id", ids)
      )
    : { data: [], error: null };
  if (error) throw new Error(`Could not load organisations: ${error.message}`);
  const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));

  // A seat's holder IS the conference_people row (loadSeatHoldings).
  type PersonRow = {
    id: string;
    contact_email: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
  };
  const personIds = [...new Set(seats.map((s) => s.holderPersonId).filter((id): id is string => !!id))];
  const { data: people, error: peopleError } = personIds.length
    ? await selectInChunks<PersonRow>(personIds, (ids) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the seat reader's structural client
        (db as any)
          .from("conference_people")
          .select("id, contact_email, emergency_contact_name, emergency_contact_phone")
          .in("id", ids)
      )
    : { data: [] as PersonRow[], error: null };
  if (peopleError) throw new Error(`Could not load people: ${peopleError.message}`);
  const personById = new Map((people ?? []).map((p) => [p.id, p]));
  const text = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

  return seats.map((seat) => {
    const entity = entitiesById.get(seat.entityId);
    const org = orgById.get(seat.organizationId);
    const person = seat.holderPersonId ? personById.get(seat.holderPersonId) : undefined;
    const side = deriveRegistrationTier({
      kind: seat.entityKind,
      name: seat.entityName,
      attributes: (entity?.attributes as Record<string, unknown> | null | undefined) ?? null,
    }).personKind;
    return {
      seatId: seat.seatId,
      organizationId: seat.organizationId,
      organizationName: org?.name ?? "Unknown organization",
      isTestOrg: org?.is_test === true,
      side,
      badge: org?.type === "Staff" ? "staff" : side,
      registrationName: seat.entityName,
      funded: isFundedOffer(entity?.attributes as Record<string, unknown> | null | undefined),
      holderPersonId: seat.holderPersonId,
      holderName: seat.holderName,
      email: text(person?.contact_email),
      emergencyContactName: text(person?.emergency_contact_name),
      emergencyContactPhone: text(person?.emergency_contact_phone),
      declined: declined.has(seat.seatId),
      seatedAt: seat.seatedAt,
    };
  });
}

export type RegistrationOrgRow = {
  organizationId: string;
  organizationName: string;
  isTestOrg: boolean;
  /** Seats held, less the ones it has said it will not fill. */
  seats: number;
  named: number;
  /** "Full Conference Registration ×2", one per registration it holds. */
  registrations: Array<{ name: string; seats: number }>;
  people: string[];
};

export type RegistrationSideSummary = {
  /** Named seats, one row each, by organization then name. */
  people: RegistrationListSeat[];
  /** Bought, expected, and nobody named yet. */
  unnamed: RegistrationListSeat[];
  organizations: RegistrationOrgRow[];
  /** Counts leave test organizations out. */
  counts: { people: number; unnamed: number; organizations: number; testSeats: number };
};

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** One side of the floor: its people, its still-unnamed seats and its organizations. */
export function summarizeSide(all: readonly RegistrationListSeat[], side: RegistrationSide): RegistrationSideSummary {
  const seats = all.filter((s) => s.side === side && !s.declined);
  const people = seats
    .filter((s) => s.holderPersonId)
    .sort((a, b) => byText(a.organizationName, b.organizationName) || byText(a.holderName ?? "", b.holderName ?? ""));
  const unnamed = seats
    .filter((s) => !s.holderPersonId)
    .sort((a, b) => byText(a.organizationName, b.organizationName) || byText(a.registrationName, b.registrationName));

  const orgs = new Map<string, RegistrationOrgRow & { byRegistration: Map<string, number> }>();
  for (const seat of seats) {
    const row = orgs.get(seat.organizationId) ?? {
      organizationId: seat.organizationId,
      organizationName: seat.organizationName,
      isTestOrg: seat.isTestOrg,
      seats: 0,
      named: 0,
      registrations: [],
      people: [],
      byRegistration: new Map<string, number>(),
    };
    row.seats += 1;
    if (seat.holderPersonId) {
      row.named += 1;
      if (seat.holderName) row.people.push(seat.holderName);
    }
    row.byRegistration.set(seat.registrationName, (row.byRegistration.get(seat.registrationName) ?? 0) + 1);
    orgs.set(seat.organizationId, row);
  }
  const organizations = [...orgs.values()]
    .map(({ byRegistration, ...row }) => ({
      ...row,
      people: row.people.sort(byText),
      registrations: [...byRegistration.entries()]
        .map(([name, count]) => ({ name, seats: count }))
        .sort((a, b) => byText(a.name, b.name)),
    }))
    .sort((a, b) => byText(a.organizationName, b.organizationName));

  const real = <T extends { isTestOrg: boolean }>(rows: T[]) => rows.filter((r) => !r.isTestOrg);
  return {
    people,
    unnamed,
    organizations,
    counts: {
      people: real(people).length,
      unnamed: real(unnamed).length,
      organizations: real(organizations).length,
      testSeats: seats.filter((s) => s.isTestOrg).length,
    },
  };
}
