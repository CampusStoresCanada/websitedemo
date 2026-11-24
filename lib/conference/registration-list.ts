import { selectInChunks } from "@/lib/supabase/select-in-chunks";
import { declinedSeatIds, loadSeatHoldings, loadUsageIntents } from "@/lib/conference/seats";
import { loadActiveBadgeTemplate } from "@/lib/conference/badges/document";
import { resolveBadgeVariant } from "@/lib/conference/badges/template";
import { exhibitorRegistrationIds } from "@/lib/conference/badges/print-stock";
import type { RegistrationListSeat } from "@/lib/conference/registration-list-view";

/**
 * Who is registered: every registration seat of a conference, for the admin
 * Registrations screen.
 *
 * Not a new answer to anything:
 *   - the seats are loadSeatHoldings' (the one reader of who holds what);
 *   - which badge a registration wears is read off the badge template
 *     (resolveBadgeVariant), the design that prints. A registration wears the
 *     exhibitor badge when its design looks like the one a booth's own
 *     registrations print on (exhibitorRegistrationIds), so a type moved to the
 *     exhibitor design in the badge designer changes colour here by itself;
 *   - CSC's own staff are told apart by their organization's type, as
 *     resolveConferenceTier does it.
 *
 * Left out: test organizations, and empty seats an organization has said it
 * will not fill (declinedSeatIds). Those are still paid for and nameable at
 * the desk; they are not somebody to expect.
 */
type ListDb = Parameters<typeof loadSeatHoldings>[0];

export async function loadRegistrationList(db: ListDb, conferenceId: string): Promise<RegistrationListSeat[]> {
  // entitiesById is the whole catalogue, booths included, whatever kinds the seats are narrowed to.
  const [{ seats: registrationSeats, entitiesById }, intents, template] = await Promise.all([
    loadSeatHoldings(db, { conferenceId, entityKinds: ["registration"] }),
    loadUsageIntents(db, conferenceId),
    loadActiveBadgeTemplate(db, conferenceId),
  ]);
  const declined = declinedSeatIds(registrationSeats, intents);

  const lookOf = (typeId: string) => {
    const { theme } = resolveBadgeVariant(template, { variantKey: typeId });
    return `${theme.frontOverlayUrl ?? ""}|${theme.accentColor ?? ""}`;
  };
  const exhibitorLooks = new Set([...exhibitorRegistrationIds(entitiesById)].map(lookOf));

  type OrgRow = { id: string; name: string; type: string | null; is_test: boolean | null };
  const orgIds = [...new Set(registrationSeats.map((s) => s.organizationId).filter(Boolean))];
  const { data: orgs, error } = orgIds.length
    ? await selectInChunks<OrgRow>(orgIds, (ids) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the seat reader's structural client
        (db as any).from("organizations").select("id, name, type, is_test").in("id", ids)
      )
    : { data: [] as OrgRow[], error: null };
  if (error) throw new Error(`Could not load organisations: ${error.message}`);
  const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));

  // A seat's holder IS the conference_people row (loadSeatHoldings).
  type PersonRow = {
    id: string;
    contact_email: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
  };
  const personIds = [...new Set(registrationSeats.map((s) => s.holderPersonId).filter((id): id is string => !!id))];
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

  return registrationSeats
    .filter((seat) => !declined.has(seat.seatId) && orgById.get(seat.organizationId)?.is_test !== true)
    .map((seat) => {
      const org = orgById.get(seat.organizationId);
      const person = seat.holderPersonId ? personById.get(seat.holderPersonId) : undefined;
      return {
        seatId: seat.seatId,
        organizationId: seat.organizationId,
        organizationName: org?.name ?? "Unknown organization",
        badge:
          org?.type === "Staff" ? "staff" : exhibitorLooks.has(lookOf(seat.entityId)) ? "exhibitor" : "delegate",
        registrationName: seat.entityName,
        holderPersonId: seat.holderPersonId,
        holderName: seat.holderName,
        email: text(person?.contact_email),
        emergencyContactName: text(person?.emergency_contact_name),
        emergencyContactPhone: text(person?.emergency_contact_phone),
      };
    });
}
