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
