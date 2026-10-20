import { describe, expect, it } from "vitest";
import { rankDeskOffers } from "../desk-offers";
import type { ConferenceOffer } from "../../actions/conference-entities";

/**
 * ⛔ The desk's offers are ordered by rules, never by hand: what adds a day this
 * person lacks, what is on soonest, what is for a colleague. Stephen's two
 * cases: a member on a day pass is offered the missing day; an exhibitor is
 * offered an extra staff badge and the next social event.
 */

const offer = (over: Partial<ConferenceOffer> & { id: string; name: string }): ConferenceOffer =>
  ({
    kind: "registration",
    unitPriceCents: 10000,
    eligible: true,
    ineligibleReason: null,
    remaining: null,
    soldOut: false,
    includes: [],
    accessSummary: { days: [], mealsIncluded: false, meetingDay: null, tradeShowDays: [], events: [], exhibitorCount: 0 },
    standalone: true,
    admittedDates: [],
    ...over,
  }) as ConferenceOffer;

const TUE = "2027-02-02";
const WED = "2027-02-03";
const THU = "2027-02-04";

const catalogue = [
  offer({ id: "full", name: "Full Conference Registration", admittedDates: ["2027-02-01", TUE, WED, THU] }),
  offer({ id: "tue", name: "Tuesday Day Pass", admittedDates: [TUE] }),
  offer({ id: "wed", name: "Wednesday Day Pass", admittedDates: [WED] }),
  offer({ id: "offsite", name: "Wednesday Offsite", kind: "event", admittedDates: [WED] }),
  offer({ id: "reception", name: "Tuesday Reception", kind: "event", admittedDates: [TUE] }),
  offer({ id: "dinner", name: "Monday Dinner", kind: "event", admittedDates: ["2027-02-01"] }),
  offer({ id: "booth", name: "Booth 101", kind: "booth", admittedDates: [WED] }),
  offer({ id: "nope", name: "Partner Only", eligible: false, ineligibleReason: "Partners only", admittedDates: [WED] }),
  offer({ id: "gone", name: "Sold Out Lunch", kind: "event", soldOut: true, admittedDates: [WED] }),
];

const ids = (groups: ReturnType<typeof rankDeskOffers>) =>
  groups.map((g) => [g.key, g.offers.map((o) => o.offer.id)]);

describe("rankDeskOffers", () => {
  it("offers a member on a Tuesday pass the days they lack first", () => {
    const groups = rankDeskOffers({ offers: catalogue, personDates: [TUE], today: TUE });
    expect(ids(groups)).toEqual([
      ["adds_days", ["full", "wed"]],
      ["extras", ["reception", "offsite"]],
      ["for_colleague", ["tue"]],
    ]);
    expect(groups[0].offers[1].reason).toBe("Adds Wed, Feb 3");
  });

  it("offers an exhibitor who has every day a colleague's badge and the next event", () => {
    const exhibitorCatalogue = [
      offer({ id: "staff", name: "Exhibitor Staff Registration", admittedDates: [TUE, WED, THU] }),
      offer({ id: "offsite", name: "Wednesday Offsite", kind: "event", admittedDates: [WED] }),
    ];
    const groups = rankDeskOffers({ offers: exhibitorCatalogue, personDates: [TUE, WED, THU], today: TUE });
    expect(ids(groups)).toEqual([
      ["extras", ["offsite"]],
      ["for_colleague", ["staff"]],
    ]);
  });

  it("puts registrations first for a walk-up nobody knows yet", () => {
    const groups = rankDeskOffers({ offers: catalogue, personDates: null, today: TUE });
    expect(groups[0].key).toBe("registrations");
    expect(groups[0].offers.map((o) => o.offer.id)).toEqual(["full", "tue", "wed"]);
  });

  it("hides what is past, ineligible, sold out, or a booth", () => {
    const shown = rankDeskOffers({ offers: catalogue, personDates: null, today: TUE })
      .flatMap((g) => g.offers.map((o) => o.offer.id));
    expect(shown).not.toContain("dinner");
    expect(shown).not.toContain("nope");
    expect(shown).not.toContain("gone");
    expect(shown).not.toContain("booth");
  });

  it("keeps an offer with no dates, last in its group", () => {
    const groups = rankDeskOffers({
      offers: [offer({ id: "merch", name: "Tote Bag", kind: "ticket" }), offer({ id: "rec", name: "Reception", kind: "event", admittedDates: [WED] })],
      personDates: null,
      today: TUE,
    });
    expect(groups[0].offers.map((o) => o.offer.id)).toEqual(["rec", "merch"]);
  });
});

describe("at an event's door", () => {
  it("puts the event at this door first, for a known person", () => {
    const groups = rankDeskOffers({ offers: catalogue, personDates: [TUE], today: TUE, doorEventId: "offsite" });
    expect(groups[0]).toMatchObject({ key: "at_this_door", title: "At this door" });
    expect(groups[0].offers.map((o) => o.offer.id)).toEqual(["offsite"]);
    // Not listed twice.
    expect(groups.flatMap((g) => g.offers.map((o) => o.offer.id)).filter((id) => id === "offsite")).toHaveLength(1);
  });

  it("and first for a walk-up too", () => {
    const groups = rankDeskOffers({ offers: catalogue, personDates: null, today: TUE, doorEventId: "reception" });
    expect(groups[0].offers.map((o) => o.offer.id)).toEqual(["reception"]);
  });

  it("changes nothing when this device is not at a door", () => {
    expect(ids(rankDeskOffers({ offers: catalogue, personDates: [TUE], today: TUE, doorEventId: null }))).toEqual(
      ids(rankDeskOffers({ offers: catalogue, personDates: [TUE], today: TUE }))
    );
  });
});
