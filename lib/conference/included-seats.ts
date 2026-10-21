import type { createAdminClient } from "@/lib/supabase/admin";

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

async function siblingEventSeats(db: AdminClient, registrationSeatId: string) {
  const { data: seat } = await db
    .from("entity_balance_seats")
    .select("id, balance_id, entity_id, conference_id")
    .eq("id", registrationSeatId)
    .maybeSingle();
  if (!seat) return null;
  const { data: balance } = await db
    .from("entity_balances")
    .select("purchase_id")
    .eq("id", seat.balance_id as string)
    .maybeSingle();
  if (!balance?.purchase_id) return null;
  const { data: balances } = await db
    .from("entity_balances")
    .select("id")
    .eq("purchase_id", balance.purchase_id as string);
  const balanceIds = (balances ?? []).map((b) => b.id as string);
  if (balanceIds.length === 0) return null;
  const { data: seats } = await db
    .from("entity_balance_seats")
    .select("id, entity_id, seat_index, holder_person_id, conference_entities!inner(kind)")
    .in("balance_id", balanceIds)
    .neq("entity_id", seat.entity_id as string)
    .eq("conference_entities.kind", "event")
    .order("seat_index")
    .order("id");
  return {
    conferenceId: seat.conference_id as string,
    seats: (seats ?? []) as unknown as Array<{
      id: string;
      entity_id: string;
      seat_index: number;
      holder_person_id: string | null;
    }>,
  };
}

/** Seat the registration's holder in one open seat of each event it includes. */
export async function seatIncludedEvents(
  db: AdminClient,
  registrationSeatId: string,
  personId: string
): Promise<void> {
  const found = await siblingEventSeats(db, registrationSeatId);
  if (!found || found.seats.length === 0) return;

  // Somebody already holding an event (from another seat) is not given a second.
  const { data: held } = await db
    .from("entity_balance_seats")
    .select("entity_id")
    .eq("conference_id", found.conferenceId)
    .eq("holder_person_id", personId);
  const alreadyHeld = new Set((held ?? []).map((row) => row.entity_id as string));

  const byEntity = new Map<string, string>();
  for (const seat of found.seats) {
    if (seat.holder_person_id || alreadyHeld.has(seat.entity_id) || byEntity.has(seat.entity_id)) continue;
    byEntity.set(seat.entity_id, seat.id);
  }
  for (const seatId of byEntity.values()) {
    const { error } = await db
      .from("entity_balance_seats")
      .update({ holder_person_id: personId })
      .eq("id", seatId)
      .is("holder_person_id", null);
    if (error) console.warn("[included-seats] could not seat an included event:", error.message);
  }
}

/** Free the included event seats the registration's holder had from that purchase. */
export async function freeIncludedEvents(
  db: AdminClient,
  registrationSeatId: string,
  personId: string
): Promise<void> {
  const found = await siblingEventSeats(db, registrationSeatId);
  if (!found) return;
  const mine = found.seats.filter((seat) => seat.holder_person_id === personId).map((seat) => seat.id);
  if (mine.length === 0) return;
  const { error } = await db
    .from("entity_balance_seats")
    .update({ holder_person_id: null })
    .in("id", mine)
    .eq("holder_person_id", personId);
  if (error) console.warn("[included-seats] could not free included events:", error.message);
}
