import { describe, expect, it } from "vitest";
import { safeNextPath } from "../login-redirect";

/**
 * Where a sign-in page may send someone afterwards: a path on this site, and
 * nothing a browser would read as another site (2026-11-05).
 */
describe("safeNextPath", () => {
  it("keeps a path on this site, with its query and anchor", () => {
    expect(safeNextPath("/conference/2027/99/bursary", "/")).toBe("/conference/2027/99/bursary");
    expect(safeNextPath("/me?tab=agenda#today", "/")).toBe("/me?tab=agenda#today");
  });

  it("refuses anything a browser would send to another site", () => {
    for (const bad of [
      "//evil.example",
      "//evil.example/conference",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "evil.example",
    ]) {
      expect(safeNextPath(bad, "/")).toBe("/");
    }
  });

  it("falls back when there is nothing to follow", () => {
    expect(safeNextPath(null, "/onboarding")).toBe("/onboarding");
    expect(safeNextPath("", "/onboarding")).toBe("/onboarding");
  });
});
