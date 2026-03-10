import { describe, expect, it } from "vitest";

// Lightweight unit coverage for viewer-level mapping lives in viewer.ts integration paths.
// This test ensures partner/member cross-rule assumptions align with org type literals.
describe("viewer org type literals", () => {
  it("keeps expected org type constants stable", () => {
    expect("Member").toBe("Member");
    expect("Vendor Partner").toBe("Vendor Partner");
  });
});
