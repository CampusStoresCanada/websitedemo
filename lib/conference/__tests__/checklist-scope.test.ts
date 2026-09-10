import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A checklist has to be able to reach everyone it is responsible for.
 *
 * Measured 2026-08-24: the Directory Listing checklist maintains content for a
 * printed book covering 123 organisations, but `findDueOrgs` scoped on
 * `entity_balances` — so only the 30 who had purchased something at the
 * conference could ever be reminded, and NONE of the 52 member stores. The
 * other 93 printed data nothing asked them to confirm.
 */
describe("checklist scoping", () => {
  const source = readFileSync("lib/conference/checklist-engine.ts", "utf8");

  it("selects publication_id, or publication scoping silently never engages", () => {
    // The classic version of this bug: the branch is written, the column is
    // never selected, and it quietly falls back to purchasers forever.
    expect(source).toMatch(/\.select\([^)]*publication_id/);
  });

  it("reaches nobody when the publication is missing, rather than falling back", () => {
    // Falling back to purchaser scoping would mail the wrong population about
    // the wrong thing — worse than sending nothing.
    expect(source).toContain("if (!saved) return []");
  });

  it("keeps purchaser scoping for checklists with no publication", () => {
    expect(source).toContain('.from("entity_balances")');
    expect(source).toContain("checklist.scope_entity_id");
  });
});

describe("publication scoping resolves the whole listed network", () => {
  it("returns every listed org, deduped across sections", async () => {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));

    const entry = (orgId: string) => ({
      orgId, orgName: orgId, orgSlug: orgId, logoUrl: null, description: null,
      featuredProduct: null, featuredProductDetail: null, catalogueUrl: null,
      rawCategories: null, boothNumbers: [], publicCode: null, orgType: null,
      city: null, province: null, website: null, orgPhone: null,
      publicEmail: null, publicPhone: null, institutionType: null, fte: null, primaryContact: null, contacts: [],
      completeness: { orgId, orgName: orgId, orgSlug: null, fields: [], requiredFilled: 0,
        requiredTotal: 0, enhancedFilled: 0, enhancedTotal: 0, overallPct: 0,
        missing: [], isPrintReady: false },
    });

    const { composePublication, sourceKey } = await import("@/lib/publication/composition");
    const CONF = { kind: "conference", conferenceId: "c1" } as const;
    const MEMBERS = { kind: "organizations", orgType: "Member" } as const;

    const doc = composePublication(
      {
        id: "p", title: "Directory", source: CONF,
        selection: { dedupeAcrossSections: true },
        sections: [
          { type: "listings", title: "Exhibitors", groupBy: "name", source: CONF },
          { type: "listings", title: "Members", groupBy: "name", style: "member", source: MEMBERS },
        ],
      },
      new Map([
        [sourceKey(CONF), [entry("partner-a")]],
        [sourceKey(MEMBERS), [entry("member-a"), entry("member-b")]],
      ])
    );

    // This is the set the checklist must reach: exhibitors AND member stores.
    expect(doc.entries.map((e) => e.orgId).sort()).toEqual(["member-a", "member-b", "partner-a"]);
  });
});
