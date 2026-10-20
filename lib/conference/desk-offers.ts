/**
 * What the check-in desk offers, in what order — by RULES, never by hand.
 *
 * ⛔ No offer has a hand-set position. The order falls out of three facts the
 * catalogue already holds: who may buy it (eligibility, already resolved for
 * the buyer's tier), the dates it gets someone in (admittedDates, the same rule
 * check-in uses), and what the person at the desk already holds. If an offer's
 * days or audience are not set in the Build step it cannot be placed well, and
 * it falls to the bottom rather than being guessed about.
 *
 *   Known person (scanned or found):
 *     1. Registrations that ADD a day they do not have   — a member on a day pass
 *     2. Events and extras, soonest first                — tonight's reception
 *     3. Registrations that add no day for them          — "for a colleague"
 *   Walk-up (nobody known yet):
 *     1. Registrations, soonest first                    — they need a badge
 *     2. Events and extras, soonest first
 *   At an event's door (either case): that event comes first — the person is
 *   standing at it (Stephen, 2026-10-20).
 *
 * Hidden: anything ineligible or sold out, booths and membership renewals (the
 * same exclusion as the self-purchase block — selfBuyableOffers), and anything
 * whose every date has already passed.
 *
 * Pure, so the rules are tested without a database or a render.
 */

import type { ConferenceOffer } from "@/lib/actions/conference-entities";
import { selfBuyableOffers } from "@/lib/conference/self-purchase";

export type DeskOfferGroupKey = "at_this_door" | "adds_days" | "registrations" | "extras" | "for_colleague";

export type RankedDeskOffer = {
  offer: ConferenceOffer;
  /** One plain line on why it is here, for the operator. Empty when obvious. */
  reason: string;
};

export type DeskOfferGroup = {
  key: DeskOfferGroupKey;
  title: string;
  offers: RankedDeskOffer[];
};

const GROUP_TITLES: Record<DeskOfferGroupKey, string> = {
  at_this_door: "At this door",
  adds_days: "Adds a day",
  registrations: "Registrations",
  extras: "Events and extras",
  for_colleague: "For a colleague",
};

/** "2027-02-03" → "Wed, Feb 3". Dates are calendar days, so read in UTC. */
export function shortDay(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function listDays(dates: string[]): string {
  return dates.map(shortDay).join(", ");
}

export function rankDeskOffers(params: {
  offers: ConferenceOffer[];
  /** The person's check-in dates, or null for a walk-up nobody knows yet. */
  personDates: string[] | null;
  /** Today at the conference, YYYY-MM-DD. */
  today: string;
  /** The event this device is checking in to, if any (lib/conference/door.ts). */
  doorEventId?: string | null;
}): DeskOfferGroup[] {
  const { personDates, today } = params;
  const held = new Set(personDates ?? []);

  const placed = new Map<DeskOfferGroupKey, Array<RankedDeskOffer & { soonest: string | null }>>();
  const put = (key: DeskOfferGroupKey, entry: RankedDeskOffer & { soonest: string | null }) => {
    const list = placed.get(key) ?? [];
    list.push(entry);
    placed.set(key, list);
  };

  for (const offer of selfBuyableOffers(params.offers)) {
    if (offer.soldOut) continue;
    const dates = offer.admittedDates ?? [];
    const upcoming = dates.filter((d) => d >= today);
    // Every date in the past: yesterday's dinner is not for sale today.
    if (dates.length > 0 && upcoming.length === 0) continue;
    const soonest = upcoming[0] ?? null;
    const isRegistration = offer.kind === "registration";

    if (params.doorEventId && offer.id === params.doorEventId) {
      put("at_this_door", { offer, soonest, reason: "" });
      continue;
    }

    if (!isRegistration) {
      put("extras", { offer, soonest, reason: soonest ? shortDay(soonest) : "" });
      continue;
    }
    if (personDates === null) {
      // No reason line: the card itself says what the registration includes,
      // and a list of every date it reaches (a Tuesday pass reaches Monday's
      // reception) reads as noise next to it.
      put("registrations", { offer, soonest, reason: "" });
      continue;
    }
    const newDays = upcoming.filter((d) => !held.has(d));
    if (newDays.length > 0) {
      put("adds_days", { offer, soonest, reason: `Adds ${listDays(newDays)}` });
    } else {
      put("for_colleague", { offer, soonest, reason: "They already have these days" });
    }
  }

  const order: DeskOfferGroupKey[] =
    personDates === null
      ? ["at_this_door", "registrations", "extras"]
      : ["at_this_door", "adds_days", "extras", "for_colleague"];

  return order
    .map((key) => ({
      key,
      title: GROUP_TITLES[key],
      offers: (placed.get(key) ?? [])
        // Soonest first; an offer with no dates goes last, then by name.
        .sort(
          (a, b) =>
            (a.soonest ?? "9999-99-99").localeCompare(b.soonest ?? "9999-99-99") ||
            a.offer.name.localeCompare(b.offer.name)
        )
        .map(({ offer, reason }) => ({ offer, reason })),
    }))
    .filter((group) => group.offers.length > 0);
}
