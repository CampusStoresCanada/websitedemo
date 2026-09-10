import { describe, expect, it } from "vitest";
import { tokenFromScannedValue } from "@/lib/conference/badges/tokens";

/**
 * A camera reads the whole QR, and the QR is a URL. The check-in desk hashes
 * what it is handed — so when badges stopped carrying a bare id, every badge
 * came back `invalid_token`. That failure surfaces at the desk on day one with
 * a queue forming, so it is pinned here instead.
 */
describe("tokenFromScannedValue", () => {
  it("passes a bare token through untouched", () => {
    expect(tokenFromScannedValue("DKhq2XLbe2IGHdNb")).toBe("DKhq2XLbe2IGHdNb");
  });

  it("extracts the token from the printed scan URL", () => {
    expect(tokenFromScannedValue("https://campusstores.ca/scan/DKhq2XLbe2IGHdNb")).toBe(
      "DKhq2XLbe2IGHdNb"
    );
  });

  it("survives a trailing query string", () => {
    expect(tokenFromScannedValue("https://campusstores.ca/scan/DKhq2XLbe2IGHdNb?s=b")).toBe(
      "DKhq2XLbe2IGHdNb"
    );
  });

  it("survives a hash fragment", () => {
    expect(tokenFromScannedValue("https://campusstores.ca/scan/DKhq2XLbe2IGHdNb#x")).toBe(
      "DKhq2XLbe2IGHdNb"
    );
  });

  it("handles a localhost render URL", () => {
    expect(tokenFromScannedValue("http://localhost:3000/scan/DKhq2XLbe2IGHdNb")).toBe(
      "DKhq2XLbe2IGHdNb"
    );
  });

  it("still returns the legacy person-uuid form the desk falls back to", () => {
    const uuid = "be872794-ee71-4f1b-9727-d65440ed6bd2";
    expect(tokenFromScannedValue(uuid)).toBe(uuid);
  });

  it("trims whitespace a handheld scanner may append", () => {
    expect(tokenFromScannedValue("  DKhq2XLbe2IGHdNb\n")).toBe("DKhq2XLbe2IGHdNb");
  });

  it("returns empty for empty input rather than throwing", () => {
    expect(tokenFromScannedValue("")).toBe("");
  });
});
