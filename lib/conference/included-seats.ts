import type { createAdminClient } from "@/lib/supabase/admin";
import { loadSeatHoldings, setSeatHolder, type SeatHolding } from "@/lib/conference/seats";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * A registration carries everything it includes (Stephen, 2026-10-21: "delegate
 * tickets should just hold everything they're entitled to to whoever is
 * assigned it").
 *
 * Buying one Full Conference Registration mints, from the SAME purchase, one
 * Meet & Greet seat and one Wednesday Offsite seat (mint_v3_for_order expands
 * the `includes` graph). Those used to sit empty for the org to hand out, so a
 * delegate named to the registration was not on the reception list. Now
 * whoever holds the registration seat holds its included event seats, and
 * releasing it frees them.
 *
 * ⛔ The purchase is the link, never the entity name: the included seats are
 * the ones minted alongside THIS registration, so a second purchase's seats
 * (somebody else's registration) are never taken.
 */

async function siblingEventSeats(
  db: AdminClient,
  conferenceId: string,
  registrationSeatId: string
): Promise<SeatHolding[]> {
  const { seats: found } = await loadSeatHoldings(db, { conferenceId, seatIds: [registrationSeatId] });
  const registration = found[0];
  if (!registration?.balanceId) return [];
  const { data: balance } = await db
    .from("entity_balances")
    .select("purchase_id")
    .eq("id", registration.balanceId)
    .maybeSingle();
  if (!balance?.purchase_id) return [];
  const { data: balances } = await db
    .from("entity_balances")
    .select("id")
    .eq("purchase_id", balance.purchase_id as string);
  const balanceIds = (balances ?? []).map((b) => b.id as string);
  if (balanceIds.length === 0) return [];
  const { seats } = await loadSeatHoldings(db, { conferenceId, balanceIds, entityKinds: ["event"] });
  return seats
    .filter((seat) => seat.entityId !== registration.entityId)
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0) || a.seatId.localeCompare(b.seatId));
}

/** Seat the registration's holder in one open seat of each event it includes. */
export async function seatIncludedEvents(
  db: AdminClient,
  conferenceId: string,
  registrationSeatId: string,
  personId: string
): Promise<void> {
  try {
    const siblings = await siblingEventSeats(db, conferenceId, registrationSeatId);
    if (siblings.length === 0) return;
    // Somebody already holding an event (from another seat) is not given a second.
    const { seats: held } = await loadSeatHoldings(db, { conferenceId, holderPersonId: personId });
    const alreadyHeld = new Set(held.map((seat) => seat.entityId));
    const byEntity = new Map<string, string>();
    for (const seat of siblings) {
      if (seat.holderPersonId || alreadyHeld.has(seat.entityId) || byEntity.has(seat.entityId)) continue;
      byEntity.set(seat.entityId, seat.seatId);
    }
    for (const seatId of byEntity.values()) {
      const result = await setSeatHolder(db, seatId, personId, { onlyIfEmpty: true });
      if (result.error) console.warn("[included-seats] could not seat an included event:", result.error);
    }
  } catch (error) {
    // The registration itself is seated; a missed event is not worth failing it.
    console.warn("[included-seats] could not seat included events:", error);
  }
}

/** Free the included event seats the registration's holder had from that purchase. */
export async function freeIncludedEvents(
  db: AdminClient,
  conferenceId: string,
  registrationSeatId: string,
  personId: string
): Promise<void> {
  try {
    const siblings = await siblingEventSeats(db, conferenceId, registrationSeatId);
    for (const seat of siblings) {
      if (seat.holderPersonId !== personId) continue;
      const result = await setSeatHolder(db, seat.seatId, null, { onlyIfHeldBy: personId });
      if (result.error) console.warn("[included-seats] could not free an included event:", result.error);
    }
  } catch (error) {
    console.warn("[included-seats] could not free included events:", error);
  }
}
