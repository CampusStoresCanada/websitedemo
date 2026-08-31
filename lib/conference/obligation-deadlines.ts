import type { DataObligation } from "./grants";

/**
 * When the things a person owes are actually due.
 *
 * `DataObligation.deadline` is a SYMBOL — "badge_print", "offsite_lock",
 * "travel_cutoff", "registration_close" — and only one of the four has ever
 * had a date behind it. This resolves what can be resolved and is explicit
 * about the rest.
 *
 * ⛔ It deliberately does NOT derive the missing ones. "Badge names due seven
 * days before the doors open" and "dietary due fourteen days before the
 * offsite" are catering and print facts that somebody at CSC knows and the
 * schema does not. Inventing them would put a date on a screen that reads as a
 * promise, and people would plan to it. An honest "no date set" is worse to
 * look at and better to act on.
 */

export type ConferenceDates = {
  /** YYYY-MM-DD. */
  startDate: string | null;
  /** ISO timestamp. */
  registrationCloseAt: string | null;
  /** YYYY-MM-DD. */
  hotelBookingCutoff: string | null;
  /** YYYY-MM-DD. When the caterer needs final dietary counts. */
  cateringCutoff: string | null;
};

export type ResolvedDeadline = {
  /** YYYY-MM-DD, or null when nothing in the schema answers it. */
  dueOn: string | null;
  /** The symbol, kept so a reader can be told what it is waiting on. */
  symbol: DataObligation["deadline"];
};

/** The date part of an ISO timestamp, without parsing it into an instant. */
function dayOf(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
  return m ? m[1] : null;
}

export function resolveObligationDeadline(
  symbol: DataObligation["deadline"],
  dates: ConferenceDates
): ResolvedDeadline {
  switch (symbol) {
    case "registration_close":
      return { dueOn: dayOf(dates.registrationCloseAt), symbol };
    case "catering_cutoff":
      return { dueOn: dates.cateringCutoff, symbol };
    // No column, no derivation. See the note above.
    case "badge_print":
    case "offsite_lock":
    case "travel_cutoff":
      return { dueOn: null, symbol };
  }
}

/**
 * Reader-facing wording for a symbol with no date.
 *
 * "No date set" alone invites "so when?", and the honest answer is "it depends
 * on something we have not recorded". Naming the thing at least tells someone
 * what to chase.
 */
export const DEADLINE_WAITING_ON: Record<DataObligation["deadline"], string> = {
  registration_close: "when registration closes",
  catering_cutoff: "before the caterer needs final numbers",
  badge_print: "before badges are printed",
  offsite_lock: "before the offsite numbers are locked",
  travel_cutoff: "before the travel cutoff",
};
