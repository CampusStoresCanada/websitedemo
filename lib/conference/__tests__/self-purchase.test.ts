import { describe, it, expect } from "vitest";
import {
  selfBuyableOffers,
  unassignedByEntity,
  SELF_PURCHASE_EXCLUDED_KINDS,
} from "@/lib/conference/self-purchase";
import type { ConferenceOffer } from "@/lib/actions/conference-entities";
import type { SeatHolding } from "@/lib/conference/seats";

function offer(over: Partial<ConferenceOffer> & { id: string; kind: string }): ConferenceOffer {
  return {
    name: over.id,
    unitPriceCents: 9900,
    eligible: true,
    soldOut: false,
    remaining: null,
    ineligibleReason: null,
    accessSummary: [],
    ...over,
  } as ConferenceOffer;
}

let seatCounter = 0;
function seat(entityId: string, holderPersonId: string | null): SeatHolding {
  return {
    seatId: `seat-${(seatCounter += 1)}`,
    conferenceId: "conf-1",
    organizationId: "org-1",
    seatIndex: null,
    entityId,
    entityKind: "event",
    entityName: entityId,
    holderPersonId,
    holderName: null,
    holderUserId: null,
    holderContactId: null,
    seatedAt: null,
  } as SeatHolding;
}

describe("what a person can buy from their own account page", () => {
  it("never offers a booth", () => {
    // ⛔ A booth is a months-long sales conversation with a floor plan and a
    // contract. The check-in desk already refuses to sell one; the phone in
    // somebody's hand is not a better place for it.
    const out = selfBuyableOffers([
      offer({ id: "booth-601", kind: "booth" }),
      offer({ id: "reception", kind: "event" }),
    ]);
    expect(out.map((o) => o.id)).toEqual(["reception"]);
  });

  it("never offers a membership renewal", () => {
    // ⛔ Dues, not a conference extra. It moves the organisation's standing for
    // a year, and a colleague must not renew it from a hallway because a
    // button happened to be on the page.
    const out = selfBuyableOffers([
      offer({ id: "renewal-2027", kind: "membership_renewal" }),
      offer({ id: "day-pass", kind: "registration" }),
    ]);
    expect(out.map((o) => o.id)).toEqual(["day-pass"]);
  });

  it("drops what the buyer is not eligible for, rather than failing at the cart", () => {
    // listConferenceOffers has already resolved audience, buyer tier and any
    // requires_ownership_of gate into this flag. A button that refuses them
    // one tap later is the worst possible place to learn it.
    const out = selfBuyableOffers([
      offer({ id: "members-only", kind: "event", eligible: false, ineligibleReason: "Members only." }),
      offer({ id: "open-to-all", kind: "event" }),
    ]);
    expect(out.map((o) => o.id)).toEqual(["open-to-all"]);
  });

  it("still offers something the organisation already holds a free seat of", () => {
    // ⛔ THE REGRESSION THIS GUARDS: hiding the card when a spare seat exists
    // leaves an org with one unassigned ticket unable to buy the other three
    // their guest needs — and with no explanation on the page.
    const offers = [offer({ id: "reception", kind: "event" })];
    const free = unassignedByEntity([seat("reception", null)]);
    expect(selfBuyableOffers(offers).map((o) => o.id)).toEqual(["reception"]);
    expect(free.get("reception")).toBe(1);
  });

  it("counts only seats nobody is named to", () => {
    const free = unassignedByEntity([
      seat("reception", null),
      seat("reception", "person-1"),
      seat("reception", null),
      seat("dinner", "person-2"),
    ]);
    expect(free.get("reception")).toBe(2);
    // An entity whose every seat is assigned is absent, not zero — the caller
    // reads `?? 0`, and an entry saying 0 would render "already has 0 spare".
    expect(free.get("dinner")).toBeUndefined();
  });

  it("the excluded list is the same pair the desk refuses", () => {
    expect([...SELF_PURCHASE_EXCLUDED_KINDS].sort()).toEqual(["booth", "membership_renewal"]);
  });
});
