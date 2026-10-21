import { logAuditEventSafe } from "@/lib/ops/audit";
import type { createAdminClient } from "@/lib/supabase/admin";
import { loadSeatHoldings, setSeatHolder } from "@/lib/conference/seats";
import { freeIncludedEvents } from "./included-seats";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Release one seat: the one way a seat is emptied, whoever asks.
 *
 * Callers check permission first. Used by the org page's Unassign
 * (deallocateSeat) and by deleting a contact (deleteContact), which used to
 * archive the person and leave them holding their seats: Neil Raymond and Yvan
 * Turcotte, both deleted seconds after being named, kept a seat and a roster
 * entry nobody could see on the org page (2026-10-21).
 */
export async function releaseSeat(
  db: AdminClient,
  conferenceId: string,
  seatId: string,
  actorId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  let seat;
  try {
    seat = (await loadSeatHoldings(db, { conferenceId, seatIds: [seatId] })).seats[0];
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Seat not found." };
  }
  if (!seat) return { ok: false, error: "Seat not found." };
  const holder = seat.holderPersonId;

  const emptied = await setSeatHolder(db, seatId, null);
  if (emptied.error) return { ok: false, error: emptied.error };

  if (holder) {
    try {
      // Their registration's included events go with it (included-seats.ts).
      if (seat.entityKind === "registration") await freeIncludedEvents(db, conferenceId, seatId, holder);
      await releaseRosterEntry(db, conferenceId, holder, seat.organizationId, actorId);
    } catch (error) {
      // The seat is free; the roster tidy-up is not worth reporting a failure for.
      console.warn("[release-seat] roster tidy-up failed:", error);
    }
  }
  return { ok: true };
}

/** Release every seat a contact holds, at every conference: they are gone. */
export async function releaseSeatsForContact(db: AdminClient, contactId: string, actorId: string | null): Promise<void> {
  const { data: people } = await db
    .from("conference_people")
    .select("id, conference_id")
    .eq("canonical_person_id", contactId);
  for (const person of people ?? []) {
    const conferenceId = person.conference_id as string;
    const { seats } = await loadSeatHoldings(db, { conferenceId, holderPersonId: person.id as string });
    // Events first, registrations last: the roster entry is judged once
    // nothing is left.
    const ordered = [...seats].sort(
      (a, b) => Number(a.entityKind === "registration") - Number(b.entityKind === "registration")
    );
    for (const seat of ordered) await releaseSeat(db, conferenceId, seat.seatId, actorId);
  }
}

/**
 * Somebody whose last seat was just released is not coming.
 *
 * ⛔ Their roster entry used to stay, marked "unassigned", and the desk's Find
 * lists every roster entry: a person nobody is sending could still be found,
 * checked in and printed a badge (Stephen, 2026-10-21: "otherwise we're
 * printing badges for people who don't exist"). So the entry goes.
 *
 * ⛔ Except when it carries history. Deleting a roster entry cascades to the
 * badge scans of that person and the exhibitor leads made from them; a check-in
 * is a record that they came. Those stay "unassigned", and the desk refuses
 * them (Find hides them, a badge will not print).
 */
async function releaseRosterEntry(
  db: AdminClient,
  conferenceId: string,
  personId: string,
  organizationId: string,
  actorId: string | null
): Promise<void> {
  const [{ seats: stillHeld }, { data: person }, { count: scans }, { count: leads }] = await Promise.all([
    loadSeatHoldings(db, { conferenceId, holderPersonId: personId }),
    db.from("conference_people").select("id, checked_in_at, source_type").eq("id", personId).maybeSingle(),
    db
      .from("conference_badge_scans")
      .select("id", { count: "exact", head: true })
      .eq("scanned_person_id", personId),
    db
      .from("conference_lead_disclosures")
      .select("id", { count: "exact", head: true })
      .eq("member_person_id", personId),
  ]);
  if (stillHeld.length > 0 || !person) return;

  const hasHistory = Boolean(person.checked_in_at) || (scans ?? 0) > 0 || (leads ?? 0) > 0;
  if (hasHistory || person.source_type !== "manual") {
    await db
      .from("conference_people")
      .update({ person_kind: "unassigned", registration_tier: null })
      .eq("id", personId);
    return;
  }

  const { error } = await db.from("conference_people").delete().eq("id", personId);
  if (error) {
    // Better a stray unassigned entry than a seat release that failed.
    await db
      .from("conference_people")
      .update({ person_kind: "unassigned", registration_tier: null })
      .eq("id", personId);
    return;
  }
  await logAuditEventSafe({
    action: "conference_attendee_removed",
    entityType: "conference_people",
    entityId: personId,
    actorId,
    actorType: "user",
    details: { organizationId, reason: "Their last seat was released." },
  });
}
