import { describe, it, expect } from "vitest";
import { extractDomain } from "@/lib/applications/duplicate-match";

describe("extractDomain", () => {
  // The regression this guard exists for. A partner submitted "N/A" as their
  // website; the old parse reduced "https://N/A" to "n", which ran as
  // `website ilike '%n%'` and matched ~100 organizations — several of them
  // labelled "already has a paid invoice — approving may double-charge" —
  // burying the single real duplicate.
  it("returns null for placeholder website values rather than a matchable fragment", () => {
    for (const junk of ["https://N/A", "N/A", "n/a", "http://n/a", "none", "tbd", "-", "..."]) {
      expect(extractDomain(junk), `${junk} must not yield a domain`).toBeNull();
    }
  });

  it("never returns a value without a dot", () => {
    // A dotless value is what makes the substring ilike match everything.
    for (const input of ["n", "localhost", "http://localhost:3000", "intranet", "com"]) {
      expect(extractDomain(input)).toBeNull();
    }
  });

  it("extracts the domain from email addresses", () => {
    expect(extractDomain("catherine@agency1008.ca")).toBe("agency1008.ca");
    expect(extractDomain("Mohammed@PremiumUniforms.com")).toBe("premiumuniforms.com");
  });

  it("extracts the domain from URLs, dropping scheme, www, port, path and fragment", () => {
    expect(extractDomain("https://www.threadwallets.com")).toBe("threadwallets.com");
    expect(extractDomain("https://www.rains.com/path?x=1#frag")).toBe("rains.com");
    expect(extractDomain("http://spiritwearcanada.ca/")).toBe("spiritwearcanada.ca");
    expect(extractDomain("https://example.com:8443/x")).toBe("example.com");
  });

  it("keeps multi-label domains intact", () => {
    expect(extractDomain("shop.example.co.uk")).toBe("shop.example.co.uk");
  });

  it("tolerates a trailing dot and surrounding whitespace", () => {
    expect(extractDomain("  https://example.com.  ")).toBe("example.com");
  });

  it("returns null for empty and nullish input", () => {
    expect(extractDomain(null)).toBeNull();
    expect(extractDomain(undefined)).toBeNull();
    expect(extractDomain("")).toBeNull();
    expect(extractDomain("   ")).toBeNull();
  });
});
