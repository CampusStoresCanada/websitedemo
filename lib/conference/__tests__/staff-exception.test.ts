import { describe, expect, it } from "vitest";
import { isLegallyExempt, isPolicyRequired, type PolicyTargeting } from "../legal-policies";
import { canBuy, effectiveBuyerTiers } from "../entity-pricing";

/**
 * Staff are an EXCEPTION, not a reduction.
 *
 * ⛔ CSC's own staff are agents and officers of the organisation running the
 * conference — not a counterparty to its terms. They were being asked to accept
 * a *Member* Code of Conduct and to satisfy a Membership Renewal, i.e. CSC
 * renewing a membership with itself.
 *
 * ⚠️ The trap when fixing that is taking capability away instead of paperwork.
 * Naming Staff as its own tier would, on its own, lock them out of six
 * member-gated offers — both $99 socials, three day passes and Full Conference
 * Registration — and fail silently at the point of purchase. They function as
 * members here; only the legal gate changes.
 */

const policy = (over: Partial<PolicyTargeting> = {}): PolicyTargeting => ({
  policyEntityId: "p1",
  appliesToAll: false,
  whoSourceRoles: [],
  requiredByEntityIds: [],
  acceptBy: null,
  ...over,
});

const who = (roles: string[], held: string[] = []) => ({
  audienceSourceRoles: roles,
  heldEntityIds: held,
  role: "assignee" as const,
});

describe("the staff legal exception", () => {
  /**
   * ⛔ THE test. Terms & Conditions and Privacy & Recording Release both carry
   * applies_to_all, which bypasses audience and seat targeting entirely — so
   * targeting alone could never have exempted staff. Only an explicit exception
   * reaches them.
   */
  it("exempts staff even from a policy that applies to everyone", () => {
    expect(isPolicyRequired(policy({ appliesToAll: true }), who(["staff"]))).toBe(false);
    expect(isPolicyRequired(policy({ appliesToAll: true }), who(["member"]))).toBe(true);
  });

  it("exempts staff from an audience-targeted policy", () => {
    const p = policy({ whoSourceRoles: ["member", "staff"] });
    expect(isPolicyRequired(p, who(["staff"]))).toBe(false);
  });

  it("exempts staff from a policy a held registration requires", () => {
    const p = policy({ requiredByEntityIds: ["staff-reg"] });
    expect(isPolicyRequired(p, who(["staff"], ["staff-reg"]))).toBe(false);
    expect(isPolicyRequired(p, who(["member"], ["staff-reg"]))).toBe(true);
  });

  it("exempts nobody else", () => {
    for (const tier of ["member", "partner", "non_member", "public"]) {
      expect(isLegallyExempt(who([tier]))).toBe(false);
    }
    expect(isLegallyExempt(who(["staff"]))).toBe(true);
  });
});

describe("staff keep member capability", () => {
  const offer = (tiers: string[]) => {
    const member = { id: "aud", kind: "audience", name: "", attributes: { source_role: tiers[0] }, refs: [] };
    return {
      offer: {
        id: "o", kind: "registration", name: "Offer", isForSale: true, priceCents: 9900,
        attributes: {}, inventory: null, tierPrices: {},
        refs: [{ toEntityId: "aud", role: "who", quantity: null }],
      },
      byId: new Map([["aud", member]]),
    };
  };

  // ⛔ The reduction this exists to prevent.
  it("lets staff buy a member-gated offer", () => {
    const { offer: o, byId } = offer(["member"]);
    expect(canBuy(o as never, "staff", byId as never).ok).toBe(true);
  });

  it("does not let staff buy a partner-gated offer", () => {
    const { offer: o, byId } = offer(["partner"]);
    expect(canBuy(o as never, "staff", byId as never).ok).toBe(false);
  });

  it("widens nobody else", () => {
    expect(effectiveBuyerTiers("staff")).toEqual(["staff", "member"]);
    expect(effectiveBuyerTiers("member")).toEqual(["member"]);
    expect(effectiveBuyerTiers("public")).toEqual(["public"]);
  });
});
