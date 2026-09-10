import { describe, expect, it } from "vitest";
import { reprintModeForOrganization } from "../print-stock";

/**
 * ⛔ A reprint is two different jobs and the desk needs to know which.
 *
 * A company with an outstanding seat already has blank cards in the run —
 * branded, mapped, no person on them — so a reprint only has to add name, title
 * and scan code. That is monochrome, which is what the on-site thermal printer
 * can do. A company with every seat named has no blanks, so the whole card has
 * to be reproduced in colour on different hardware.
 */
describe("reprintModeForOrganization", () => {
  it("prints only the variable data when a company blank exists", () => {
    const r = reprintModeForOrganization({
      organizationId: "crestar",
      unnamedSeatOrganizationIds: ["crestar", "vitalsource"],
    });
    expect(r.mode).toBe("variable_only");
  });

  it("prints the whole badge when every seat at that company is named", () => {
    const r = reprintModeForOrganization({
      organizationId: "boxercraft",
      unnamedSeatOrganizationIds: ["crestar"],
    });
    expect(r.mode).toBe("full_badge");
  });

  // ⚠️ A reprint spare carries no organisation, so nothing could be waiting.
  it("prints the whole badge when there is no organisation at all", () => {
    expect(
      reprintModeForOrganization({ organizationId: null, unnamedSeatOrganizationIds: ["crestar"] })
        .mode
    ).toBe("full_badge");
  });

  it("explains itself, because the operator is standing at a printer", () => {
    for (const args of [
      { organizationId: "crestar", unnamedSeatOrganizationIds: ["crestar"] },
      { organizationId: "boxercraft", unnamedSeatOrganizationIds: ["crestar"] },
      { organizationId: null, unnamedSeatOrganizationIds: [] },
    ]) {
      expect(reprintModeForOrganization(args).reason.length).toBeGreaterThan(20);
    }
  });
});
