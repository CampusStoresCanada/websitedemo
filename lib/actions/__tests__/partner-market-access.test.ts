import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isOrgAccessActive } from "@/lib/membership/status";

const src = () =>
  fs.readFileSync(path.join(process.cwd(), "lib/actions/partner-market.ts"), "utf8");

describe("a lapsed partner keeps nothing", () => {
  it("locked and canceled are not access-active; grace and reactivated are", () => {
    expect(isOrgAccessActive("locked")).toBe(false);
    expect(isOrgAccessActive("canceled")).toBe(false);
    expect(isOrgAccessActive("grace")).toBe(true);
    expect(isOrgAccessActive("reactivated")).toBe(true);
    expect(isOrgAccessActive("active")).toBe(true);
    expect(isOrgAccessActive(null)).toBe(false);
  });

  it("the market endpoint checks the org's own access, not just membership of it", () => {
    expect(src()).toContain("isOrgAccessActive");
  });

  it("⛔ keeps the ORG scope — activeOrgIds, never orgAdminOrgIds", () => {
    // Reading your market is not an admin act; rating it is. Collapsing the two
    // would take the panel from every non-admin who uses it today.
    expect(src()).toContain("auth.ctx.activeOrgIds.includes(partnerOrgId)");
    expect(src()).not.toContain("orgAdminOrgIds.includes(partnerOrgId)");
  });

  it("CSC staff still get through, so support can act on a lapsed partner", () => {
    expect(src()).toMatch(/isGlobalAdmin\(auth\.ctx\.globalRole\)/);
  });

  it("refuses without naming the org", () => {
    // A refusal that named it would confirm it exists and has a market worth hiding.
    expect(src()).toContain('error: "Not available"');
  });
});
