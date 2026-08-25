import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Brand assets in email must be cache-busted.
 *
 * The filenames never change when the artwork does, so a mail client that
 * cached the old logo keeps showing it — the 2026-08-08 wordmark replacement
 * was still rendering the previous dev-stage mark in a real inbox on 25 August,
 * while the server had been serving the correct file the whole time. Nothing
 * about that is visible from the sending side, which is why it needs a test.
 */
const source = readFileSync("lib/email/layout.ts", "utf8");

describe("email brand assets", () => {
  it("versions every asset URL", () => {
    for (const asset of ["logo-wordmark.png", "logo-mark.png", "background.png"]) {
      const line = source.split("\n").find((l) => l.includes(asset) && l.includes("${base}"));
      expect(line, `${asset} has no URL line`).toBeTruthy();
      expect(line, `${asset} is not cache-busted`).toContain("?v=${ASSET_VERSION}");
    }
  });

  it("keeps the version a fixed constant, not a per-deploy value", () => {
    // These URLs live in already-delivered mail for years. Changing the version
    // on every deploy would defeat caching for no benefit.
    expect(source).toMatch(/const ASSET_VERSION = "\d{8}"/);
    expect(source).not.toMatch(/ASSET_VERSION = .*Date\.now/);
  });
});
