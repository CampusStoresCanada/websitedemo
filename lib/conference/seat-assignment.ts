/**
 * A seat changing hands. The one place `holder_person_id` is written.
 *
 * ⛔ Assign, release and hand-over are ONE operation, not three features. The
 * desk naming a walk-up to an outstanding blank, an exhibitor releasing tonight's
 * reception ticket because a colleague is going instead, and a booth swapping who
 * holds what at 4pm are the same write with different guards. Building them
 * separately is how three answers to "who holds this seat" end up disagreeing.
 *
 * ⛔ A SEAT IS THE TICKET. Assigning it to a person is how the ticket gets given
 * (see lib/conference/attendance.ts) — access is resolved from the seats a person
 * holds, so this write is what decides whether a badge admits somebody to a
 * capped $99 reception or to nothing at all. That is why it is guarded, audited,
 * and refuses rather than guesses.
 *
 * ⚠️ Before this, exactly one code path wrote the column: registration-mint.ts,
 * zipping paid order attendees onto seats. The walk-up case is the same write
 * without the order — which is precisely why it belongs here and not in a second
 * copy next to the desk.
 */

import { logAuditEventSafe } from "@/lib/ops/audit";

export type SeatTransitionResult =
  | { ok: true; seatId: string }
  | { ok: false; code: SeatTransitionFailure; error: string };

/**
 * ⛔ Distinct codes because the desk says something different for each, with a
 * person standing there. "Failed" is not an answer an operator can act on.
 */
export type SeatTransitionFailure =
  | "not_found"
  | "already_held" // somebody else got it first
  | "not_held_by_person" // releasing a seat they do not hold
  | "wrong_organization"
  | "write_failed";

type SeatRow = {
  id: string;
  conference_id: string;
  organization_id: string | null;
  entity_id: string;
  holder_person_id: string | null;
};

async function loadSeat(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any,
  seatId: string
): Promise<SeatRow | null> {
  const { data } = await db
    .from("entity_balance_seats")
    .select("id, conference_id, organization_id, entity_id, holder_person_id")
    .eq("id", seatId)
    .maybeSingle();
  return (data as SeatRow) ?? null;
}

/**
 * Give an unheld seat to a person.
 *
 * ⛔ The update is CONDITIONAL on the seat still being unheld, and a zero-row
 * result is reported as `already_held` rather than swallowed. Two operators at
 * two laptops working the same booth's blanks is not a hypothetical — it is a
 * queue at 8am on day one. Reading, deciding, then writing would let the second
 * one silently overwrite the first, and the person whose seat was taken would
 * find out at a reception door.
 */
export async function assignSeat(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any;
  seatId: string;
  personId: string;
  /** The person's organisation, checked against the seat's. */
  organizationId: string | null;
  actorId: string | null;
  reason: string;
}): Promise<SeatTransitionResult> {
  const { db, seatId, personId } = params;
  const seat = await loadSeat(db, seatId);
  if (!seat) return { ok: false, code: "not_found", error: "That seat no longer exists." };
  if (seat.holder_person_id) {
    return {
      ok: false,
      code: "already_held",
      error: "Somebody is already named to that seat.",
    };
  }
  // ⚠️ A seat belongs to the org that bought it. Naming somebody from another
  // company to it would hand one store's paid ticket to another's staff.
  if (
    params.organizationId &&
    seat.organization_id &&
    seat.organization_id !== params.organizationId
  ) {
    return {
      ok: false,
      code: "wrong_organization",
      error: "That seat belongs to a different organisation.",
    };
  }

  const { data: updated, error } = await db
    .from("entity_balance_seats")
    .update({ holder_person_id: personId })
    .eq("id", seatId)
    .is("holder_person_id", null) // ⛔ the guard: lose the race, change nothing
    .select("id");
  if (error) return { ok: false, code: "write_failed", error: error.message };
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      code: "already_held",
      error: "Somebody was named to that seat while you were filling this in.",
    };
  }

  await logAuditEventSafe({
    action: "conference_seat_assigned",
    entityType: "entity_balance_seats",
    entityId: seatId,
    actorId: params.actorId,
    actorType: "user",
    details: {
      conferenceId: seat.conference_id,
      entityId: seat.entity_id,
      organizationId: seat.organization_id,
      personId,
      reason: params.reason,
    },
  });
  return { ok: true, seatId };
}

/**
 * Hand a seat back to the organisation's pool.
 *
 * ⛔ Releases the seat, it does NOT delete or refund it. The store paid for the
 * ticket; letting go of it means a colleague can take it, not that the money
 * went away. The seat returns to exactly the state a blank is in — unheld,
 * still owned by the org, still counted in what that reception must cater for.
 *
 * ⚠️ Conditional on the person actually holding it, so a stale phone screen
 * cannot release somebody else's ticket.
 */
export async function releaseSeat(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any;
  seatId: string;
  personId: string;
  actorId: string | null;
  reason: string;
}): Promise<SeatTransitionResult> {
  const { db, seatId, personId } = params;
  const seat = await loadSeat(db, seatId);
  if (!seat) return { ok: false, code: "not_found", error: "That seat no longer exists." };
  if (seat.holder_person_id !== personId) {
    return {
      ok: false,
      code: "not_held_by_person",
      error: "That ticket is not currently theirs to release.",
    };
  }

  const { data: updated, error } = await db
    .from("entity_balance_seats")
    .update({ holder_person_id: null })
    .eq("id", seatId)
    .eq("holder_person_id", personId)
    .select("id");
  if (error) return { ok: false, code: "write_failed", error: error.message };
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      code: "not_held_by_person",
      error: "That ticket changed hands while this screen was open.",
    };
  }

  await logAuditEventSafe({
    action: "conference_seat_released",
    entityType: "entity_balance_seats",
    entityId: seatId,
    actorId: params.actorId,
    actorType: "user",
    details: {
      conferenceId: seat.conference_id,
      entityId: seat.entity_id,
      organizationId: seat.organization_id,
      personId,
      reason: params.reason,
    },
  });
  return { ok: true, seatId };
}
