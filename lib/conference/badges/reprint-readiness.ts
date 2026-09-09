/**
 * What the desk is looking at, DERIVED from the data.
 *
 * ⛔ The three situations Stephen described — an exhibitor we knew was coming, a
 * member who signed up after the cut-off, and a fifth person against a four-seat
 * booth — are not a taxonomy to write down. They are what you get when you ask
 * the graph three questions:
 *
 *   1. Does this person hold a registration seat?      entity_balance_seats
 *   2. Does their organisation have an unnamed seat?   the same table
 *   3. Which types did the run actually print spares for?
 *                                                      re-derived by the printer's
 *                                                      own rule, since the spare
 *                                                      manifest is not stored
 *
 * An earlier version of this took those three answers as parameters. That put
 * the derivation on whoever called it, which is how a caller ends up passing a
 * confident wrong boolean and the desk is told to reach for a stack that does
 * not exist.
 */

import { loadSeatHoldings } from "@/lib/conference/seats";
import { resolveBadgeRun } from "@/lib/conference/badges/run";
import {
  getBadgePrintStock,
  spareCountsByType,
  spareCountsForJob,
} from "@/lib/conference/badges/print-stock";
import type { BadgeStock } from "@/lib/conference/badges/reprint-plan";

export type ReprintReadiness =
  | {
      ready: true;
      stock: BadgeStock;
      /** Which type's spare stack to reach for. Null unless stock is a spare. */
      registrationTypeId: string | null;
      registrationTypeName: string | null;
      reason: string;
    }
  | { ready: false; blocker: "no_seat" | "no_matching_spare"; reason: string };

export async function assessReprintForPerson(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any;
  conferenceId: string;
  personId: string;
}): Promise<ReprintReadiness> {
  const { db, conferenceId, personId } = params;
  const [{ seats, entitiesById }, run, stock] = await Promise.all([
    loadSeatHoldings(db, { conferenceId }),
    resolveBadgeRun(conferenceId),
    getBadgePrintStock(conferenceId),
  ]);

  // 1. What this person holds — registration seats only. An event seat is a
  //    ticket to a reception, not something a badge is printed from.
  const held = seats
    .filter((s) => s.holderPersonId === personId)
    .filter((s) => entitiesById.get(s.entityId)?.kind === "registration")
    .map((s) => s.entityId);

  if (held.length === 0) {
    return {
      ready: false,
      blocker: "no_seat",
      reason:
        "This person holds no registration seat, so there is nothing to print. " +
        "A booth's staff registrations are a fixed allocation; extra ones sell " +
        "separately. This is a sale, then a seat, then a badge.",
    };
  }

  // 2. Does their organisation still have a seat nobody was named to? If so a
  //    blank for it went into the run, already carrying that type's schedule.
  const orgId = seats.find((s) => s.holderPersonId === personId)?.organizationId ?? null;
  const orgHasBlank =
    orgId !== null &&
    seats.some((s) => !s.holderPersonId && s.organizationId === orgId);
  if (orgHasBlank) {
    return {
      ready: true,
      stock: "company_blank",
      registrationTypeId: null,
      registrationTypeName: null,
      reason: "Their company has an unnamed seat, so a blank for it was printed.",
    };
  }

  // 3. Which types the run actually printed spares for. ⛔ Re-derived by the
  //    printer's own rule — the manifest is not recorded anywhere.
  if (!stock.enabled) {
    return {
      ready: false,
      blocker: "no_matching_spare",
      reason: "No blank for this company, and this run printed no spares at all.",
    };
  }
  const counts = await spareCountsForJob(db, conferenceId, run, stock);
  const byType = spareCountsByType(run, counts.total).filter((t) => t.count > 0);
  const match = byType.find((t) => held.includes(t.entityId));
  if (match) {
    return {
      ready: true,
      stock: "spare",
      registrationTypeId: match.entityId,
      registrationTypeName: match.name,
      reason: `No blank for this company; use one of the ${match.count} ${match.name} spares.`,
    };
  }

  // ⚠️ Spares exist, but none of THEIR type. Refusing is the point: a spare
  // carries the schedule of the type it was printed for, so the nearest stack
  // would put somebody else's four days on the back of their badge.
  return {
    ready: false,
    blocker: "no_matching_spare",
    reason:
      "No blank, and no spare was printed for their registration type. Another " +
      "type's spare would carry the wrong schedule — print the whole badge.",
  };
}
