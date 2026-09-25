import { describe, expect, it } from "vitest";
import { applyFieldMask, type VisibilityRuntimeConfig } from "@/lib/visibility/engine";
import {
  DEFAULT_CROSS_VISIBILITY_RULES,
  DEFAULT_VISIBILITY_CONFIG,
} from "@/lib/visibility/defaults";
import { resolveOrgPageBenchmarking } from "@/lib/benchmarking/org-page-visibility";
import { applyPresentationMode } from "../mode";

const config: VisibilityRuntimeConfig = {
  ...DEFAULT_VISIBILITY_CONFIG,
  cross_visibility_rules: DEFAULT_CROSS_VISIBILITY_RULES,
};

/**
 * The chain, not its links.
 *
 * mode.test.ts proves presentation mode produces the right viewer level. That
 * is not the same claim as "the data is withheld" — the level has to reach the
 * mask, and the mask has to drop the field from the payload rather than mark it
 * for the browser to hide. These assert the end of the chain, because a green
 * test on the level alone would have passed just as happily with nothing
 * downstream wired up at all.
 */
describe("presentation mode actually withholds", () => {
  // A staff account's real level. Presentation mode replaces this.
  const STAFF = "super_admin" as const;

  /**
   * ⚠️ Field masking is NOT where most of the protection comes from, and this
   * block exists to keep that honest. Measured against the shipped config:
   * a member viewing a Member org has exactly ONE field withheld, and a partner
   * viewing one has none — `private_fields` means "any signed-in viewer", and
   * members are signed in. Only `public` meaningfully thins an org page (14 of
   * 43 configured fields).
   *
   * What presentation mode actually buys is the three GATES below the field
   * mask: the org-page benchmarking decision, the admin-console block, and the
   * conference health-information gate. Anyone reading this later should not
   * infer from "presents as a member" that org fields are broadly hidden.
   */
  const memberOrgRow = {
    name: "Example University Bookstore",
    slug: "example-u",
    city: "Kingston",
    // The one org field a member does not get on another member's page.
    procurement_info: "sole-source agreement, renewal March",
  };

  it("hands staff everything when the mode is off", () => {
    const level = applyPresentationMode(STAFF, null);
    const masked = applyFieldMask(memberOrgRow, level, config, "organizations", false, "Member");

    expect(masked.procurement_info).toBe("sole-source agreement, renewal March");
  });

  it("withholds procurement_info once presenting as a member", () => {
    const level = applyPresentationMode(STAFF, "member");
    const masked = applyFieldMask(memberOrgRow, level, config, "organizations", false, "Member");

    // Serialised rather than field-by-field: a withheld field comes back as
    // null or as a teaser depending on masked_reveal_fields, and a test pinned
    // to one shape passes for the wrong reason when the other applies.
    expect(JSON.stringify(masked)).not.toContain("sole-source agreement");

    // Still a usable page to demo from.
    expect(masked.name).toBe("Example University Bookstore");
    expect(masked.city).toBe("Kingston");
  });

  it("keeps contact PII out of the payload at public level", () => {
    const contactRow = {
      profile_picture_url: "https://example.test/p.png",
      name: "A Real Person",
      work_email: "person@example.test",
    };

    const level = applyPresentationMode(STAFF, "public");
    const masked = applyFieldMask(contactRow, level, config, "contacts", false, "Member");

    const shipped = JSON.stringify(masked);
    expect(shipped).not.toContain("A Real Person");
    expect(shipped).not.toContain("person@example.test");

    // The teaser that replaces a name is initials only.
    expect(masked.name).toBe("A. R. P.");
    expect(masked.profile_picture_url).toBe("https://example.test/p.png");
  });

  /**
   * The specific bypass this was built for: org-page-visibility.ts returns
   * `detail` for staff before it asks a single disclosure question. Presentation
   * mode has to reach it through `isStaff`, which is derived from viewerLevel.
   */
  describe("the org-page benchmarking bypass", () => {
    const asStaff = (level: ReturnType<typeof applyPresentationMode>) =>
      resolveOrgPageBenchmarking({
        targetDisclosureLevel: "full",
        viewerFiled: false,
        viewerDisclosureLevel: null,
        isOwnOrg: false,
        isStaff: level === "admin" || level === "super_admin",
      });

    it("shows another store's filed figures to staff with the mode off", () => {
      expect(asStaff(applyPresentationMode(STAFF, null)).show).toBe("detail");
    });

    it("withholds them the moment the mode is on", () => {
      // "none" rather than "aggregate": the fixture's viewer has filed nothing,
      // and a non-participant now gets no results at all. Still the thing this
      // test is for — the staff bypass is gone the moment the mode is on.
      for (const audience of ["member", "partner", "public"] as const) {
        const decision = asStaff(applyPresentationMode(STAFF, audience));
        expect(decision.show).toBe("none");
      }
    });
  });
});
