import { loadSeatHoldings } from "./seats";
import { triggerConferenceScheduleReady } from "@/lib/comms/conference-triggers";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Send people the schedule a run produced.
 *
 * ⛔ THE PIPELINE ENDED HERE AND WENT NOWHERE. `conference_schedule_ready` has
 * existed as a template key for as long as the scheduler has, with ZERO senders.
 * The solver could produce a schedule, persist it, promote it — and no delegate
 * was ever told. Every stage before this one was complete and the last one did
 * not exist.
 *
 * ⛔ IDEMPOTENT PER (PERSON, RUN), NOT PER PERSON. That is the whole design:
 *
 *   same run, called twice   → the second call sends nothing
 *   a NEW run (a late add)   → legitimately re-sends, because their day changed
 *
 * Keying on the person alone would make the first send permanent and silently
 * swallow every re-send after a late add — which is exactly the population
 * `lateAdd()` reports as `alsoGained`: people already holding a schedule that
 * is now out of date. Feed those seat ids in here and the obligation is
 * discharged by the same mechanism that made it.
 */

export type ScheduleDeliveryResult = {
  /** Delegate seats whose holder was emailed. */
  sent: string[];
  /**
   * Seats that resolved to a person with no usable email.
   *
   * ⚠️ Reported, never silently dropped. A seat that cannot be told about its
   * own schedule is a person who turns up at the conference not knowing where
   * to be, and the count belongs in front of whoever ran the send.
   */
  noEmail: string[];
  /** Seat ids that matched no seat holding at all — stale or wrong conference. */
  unknownSeat: string[];
};

export async function sendSchedulesForRun(params: {
  db: AdminClient;
  conferenceId: string;
  /** The run whose schedule is being announced. Part of the idempotency key. */
  runId: string;
  /**
   * Which delegate seats to tell. Omit to mean "everyone holding a seat".
   *
   * The narrow form is the late-add case: pass `newlySeated.concat(alsoGained)`
   * and only the people whose day actually changed hear from us.
   */
  delegateSeatIds?: readonly string[];
}): Promise<ScheduleDeliveryResult> {
  const { db, conferenceId, runId, delegateSeatIds } = params;

  // Canonical reader — one answer to "who has a seat". Not a 20th query shape.
  const { seats } = await loadSeatHoldings(db, { conferenceId, assigned: true });

  const wanted = delegateSeatIds ? new Set(delegateSeatIds) : null;
  const targets = wanted ? seats.filter((s) => wanted.has(s.seatId)) : seats;

  const result: ScheduleDeliveryResult = { sent: [], noEmail: [], unknownSeat: [] };

  if (wanted) {
    const found = new Set(targets.map((s) => s.seatId));
    for (const id of wanted) if (!found.has(id)) result.unknownSeat.push(id);
  }

  const contactIds = [...new Set(targets.map((s) => s.holderContactId).filter(Boolean))] as string[];
  const emailByContact = new Map<string, { email: string | null; name: string | null }>();
  if (contactIds.length > 0) {
    const { data } = await db
      .from("contacts")
      .select("id, email, first_name, last_name")
      .in("id", contactIds);
    for (const c of data ?? []) {
      const row = c as { id: string; email: string | null; first_name: string | null; last_name: string | null };
      emailByContact.set(row.id, {
        email: row.email,
        name: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
      });
    }
  }

  const orgNameById = new Map<string, string>();
  const orgIds = [...new Set(targets.map((s) => s.organizationId))];
  if (orgIds.length > 0) {
    const { data } = await db.from("organizations").select("id, name").in("id", orgIds);
    for (const o of data ?? []) orgNameById.set((o as { id: string }).id, (o as { name: string }).name);
  }

  for (const seat of targets) {
    const contact = seat.holderContactId ? emailByContact.get(seat.holderContactId) : undefined;
    const email = contact?.email ?? null;
    if (!email) {
      result.noEmail.push(seat.seatId);
      continue;
    }

    await triggerConferenceScheduleReady({
      db,
      conferenceId,
      runId,
      personKey: seat.holderPersonId ?? seat.seatId,
      attendeeName: contact?.name ?? seat.holderName ?? "there",
      attendeeEmail: email,
      orgName: orgNameById.get(seat.organizationId) ?? "your store",
    });
    result.sent.push(seat.seatId);
  }

  return result;
}
