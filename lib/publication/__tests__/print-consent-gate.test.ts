import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The print consent gate must live in the loop that builds what prints.
 *
 * It briefly did not. The gate was a `printableOnly` flag on the contact
 * query; removing that flag — to fix a separate bug where completeness
 * counted only consented people — left the replacement filter targeting code
 * that an earlier revert had already deleted. The flag was computed and never
 * read, so every undecided person would have printed.
 *
 * Nothing about that is visible from the types, and the whole feature is a
 * promise about people's contact details, so it gets a guard.
 */
const source = readFileSync("lib/publication/composition-loader.ts", "utf8");

describe("print consent", () => {
  it("actually filters, not merely computes a flag", () => {
    expect(source).toContain("if (!candidate.printable) continue;");
  });

  it("requires an explicit yes — absence of an opt-out is not consent", () => {
    expect(source).toContain(
      'c.directory_visibility === "members" || c.directory_visibility === "public"'
    );
  });

  it("counts contacts BEFORE the gate, so completeness asks its own question", () => {
    // "Missing contacts. Add it on your profile." was shown to a company with
    // four contacts on file, none of whom had been asked yet.
    const loop = source.slice(source.indexOf("for (const c of (contacts"), source.indexOf("Ordering only"));
    expect(loop.indexOf("contactCount.set")).toBeLessThan(loop.indexOf("if (!candidate.printable)"));
  });
});
