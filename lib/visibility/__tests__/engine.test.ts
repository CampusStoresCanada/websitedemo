import { describe, expect, it } from "vitest";
import {
  applyFieldMask,
  isFieldVisible,
  type VisibilityRuntimeConfig,
} from "../engine";
import {
  DEFAULT_CROSS_VISIBILITY_RULES,
  DEFAULT_VISIBILITY_CONFIG,
} from "../defaults";

const config: VisibilityRuntimeConfig = {
  ...DEFAULT_VISIBILITY_CONFIG,
  cross_visibility_rules: DEFAULT_CROSS_VISIBILITY_RULES,
};

describe("visibility engine", () => {
  it("fails closed for unlisted fields", () => {
    expect(
      isFieldVisible("contacts.unknown_private", "public", config, "Member")
    ).toBe(false);
  });

  it("uses cross rules for member viewing partner fields", () => {
    expect(
      isFieldVisible("contacts.role_title", "member", config, "Vendor Partner")
    ).toBe(true);
  });

  it("uses cross rules for partner viewing member fields", () => {
    expect(
      isFieldVisible("organizations.procurement_info", "partner", config, "Member")
    ).toBe(true);
  });

  it("allows private fields for authenticated viewers", () => {
    expect(
      isFieldVisible("contacts.work_email", "authenticated", config, "Member")
    ).toBe(true);
    expect(
      isFieldVisible("contacts.work_email", "org_admin", config, "Member")
    ).toBe(true);
    expect(
      isFieldVisible("contacts.work_email", "member", config, "Member")
    ).toBe(true);
  });

  it("hides partner PII from other partners, but not from their own org", () => {
    // isFieldVisible has no own-org context on its own, so a bare "partner"
    // viewer conservatively gets no PII here — the bypass for a partner's own
    // org lives in applyFieldMask's isOwnOrg check, tested below.
    expect(
      isFieldVisible("contacts.work_email", "partner", config, "Vendor Partner")
    ).toBe(false);

    const ownOrgContact = applyFieldMask(
      { work_email: "jane@vendor.com" },
      "partner",
      config,
      "contacts",
      true,
      "Vendor Partner"
    );
    expect(ownOrgContact.work_email).toBe("jane@vendor.com");
  });

  it("keeps private fields hidden for public viewers", () => {
    expect(
      isFieldVisible("contacts.work_email", "public", config, "Member")
    ).toBe(false);
  });

  it("masks private contact name for public viewers", () => {
    const masked = applyFieldMask(
      {
        name: "Jane Doe",
        role_title: "Director",
        work_email: "jane@school.ca",
      },
      "public",
      config,
      "contacts",
      false,
      "Member"
    );

    expect(masked.name).toBe("J. D.");
    expect(masked.role_title).toBe(null);
    expect(masked.work_email).toBe("@school.ca");
  });
});

/**
 * A partner's promotional pitch is written for member buyers. Unlisted fields
 * fail closed, so before these were added to the cross rules the three
 * highlight_* columns resolved to admins only — 30 live partner orgs had filled
 * them in and no member could see any of it, while the partner's own admins
 * could, so nothing looked broken from either end.
 *
 * The audience is the whole point of the fix, so it is asserted in both
 * directions: members in, competing partners and anonymous traffic out.
 */
describe("a partner's pitch reaches member buyers and no one else", () => {
  const PITCH = [
    "organizations.highlight_product_name",
    "organizations.highlight_product_description",
    "organizations.highlight_the_deal",
  ] as const;

  it("is visible to a member viewing a partner", () => {
    for (const field of PITCH) {
      expect(
        isFieldVisible(field, "member", config, "Vendor Partner"),
        `${field} should be visible to a member`
      ).toBe(true);
    }
  });

  it("is hidden from a competing partner", () => {
    for (const field of PITCH) {
      expect(
        isFieldVisible(field, "partner", config, "Vendor Partner"),
        `${field} must not reach a competing partner`
      ).toBe(false);
    }
  });

  it("is hidden from anonymous traffic", () => {
    for (const field of PITCH) {
      expect(
        isFieldVisible(field, "public", config, "Vendor Partner"),
        `${field} must not be public`
      ).toBe(false);
    }
  });

  it("stays out of the public allowlist, which policy_values overrides anyway", () => {
    for (const field of PITCH) {
      expect(DEFAULT_VISIBILITY_CONFIG.public_allowlist).not.toContain(field);
    }
  });
});
