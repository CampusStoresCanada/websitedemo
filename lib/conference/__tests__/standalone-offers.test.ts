import { describe, expect, it } from "vitest";
import { canBuy, eligibleTiers } from "../entity-pricing";
import type { BuildEntity } from "@/lib/actions/conference-entities";
import { offerRequiresOwnershipOfEntityIds } from "../ownership-gate";

/**
 * Which offers may a partner buy who holds NOTHING at the conference?
 *
 * The org profile used to resolve its conference only from what the org already
 * held, so an org with nothing resolved to null and saw no storefront — the
 * exact population the Hot Products Care Package is sold to. Opening that door
 * means deciding what comes through it.
 *
 * `standalone` is the answer, and it takes TWO conditions on purpose:
 * no prerequisite, AND a declared audience. Dropping the second would make the
 * test "has no prerequisite", and the next offer marked for sale with neither
 * would appear on every partner's profile because nobody said it should not.
 */
function entity(
  id: string,
  opts: { forSale?: boolean; refs?: Array<{ role: string; to: string }> } = {}
): BuildEntity {
  return {
    id, name: id, kind: "item", conferenceId: "c1", attributes: {},
    isForSale: opts.forSale ?? true, priceCents: 1000, tierPrices: {}, inventory: null,
    refs: (opts.refs ?? []).map((r) => ({ role: r.role, toEntityId: r.to, quantity: null })),
  } as unknown as BuildEntity;
}

const partnerAudience = {
  id: "aud-partner", name: "Partner", kind: "audience", conferenceId: "c1",
  attributes: { source_role: "partner" }, refs: [],
} as unknown as BuildEntity;

/** Mirrors the rule in listConferenceOffers. */
function isStandalone(offer: BuildEntity, byId: Map<string, BuildEntity>): boolean {
  return (
    offerRequiresOwnershipOfEntityIds(offer.refs).length === 0 &&
    eligibleTiers(offer, byId).length > 0
  );
}

describe("what a partner with nothing at the conference may buy", () => {
  const byId = new Map<string, BuildEntity>([["aud-partner", partnerAudience], ["booth-1", entity("booth-1")]]);

  it("counts an offer with a declared audience and no prerequisite", () => {
    const care = entity("care-package", { refs: [{ role: "who", to: "aud-partner" }] });
    byId.set("care-package", care);
    expect(isStandalone(care, byId)).toBe(true);
  });

  it("REFUSES an offer with no audience, even though it has no prerequisite", () => {
    // The guard. Somebody marking a new offer for sale and forgetting the
    // audience must not have it land on every partner's profile.
    const unscoped = entity("mystery-offer");
    byId.set("mystery-offer", unscoped);
    expect(offerRequiresOwnershipOfEntityIds(unscoped.refs)).toEqual([]);
    expect(isStandalone(unscoped, byId)).toBe(false);
  });

  it("refuses an offer that needs something held first", () => {
    // Both staff registrations need a booth; both socials need a registration.
    const staffReg = entity("staff-reg", {
      refs: [{ role: "who", to: "aud-partner" }, { role: "requires_ownership_of", to: "booth-1" }],
    });
    byId.set("staff-reg", staffReg);
    expect(isStandalone(staffReg, byId)).toBe(false);
  });

  it("still gates on the audience itself — standalone is not a bypass", () => {
    const care = entity("care-package", { refs: [{ role: "who", to: "aud-partner" }] });
    byId.set("care-package", care);
    expect(canBuy(care, "partner", byId).ok).toBe(true);
    expect(canBuy(care, "member", byId).ok).toBe(false);
  });

  it("refuses anything not for sale, whatever else is true of it", () => {
    const draft = entity("not-yet", { forSale: false, refs: [{ role: "who", to: "aud-partner" }] });
    byId.set("not-yet", draft);
    expect(canBuy(draft, "partner", byId).ok).toBe(false);
  });
});
