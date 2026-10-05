import { describe, it, expect } from "vitest";
import {
  communityOriginFromTemplate,
  escapeHtmlAttribute,
  renderBridgeInterstitial,
  sanitizeDestination,
} from "@/lib/circle/destination";

/**
 * ?to= on /api/circle/member-space feeds a redirect that sits directly
 * behind an authenticated Circle token mint, so a permissive destination
 * is an open redirect an attacker could use to bounce a signed-in member
 * off our domain. These cases are the shapes that have to stay rejected.
 */
describe("sanitizeDestination", () => {
  it("accepts a plain Circle post path", () => {
    expect(sanitizeDestination("/c/announcements-f3687d/rush-is-over-was-yours-normal")).toBe(
      "/c/announcements-f3687d/rush-is-over-was-yours-normal"
    );
  });

  it("accepts a path carrying a query string", () => {
    expect(sanitizeDestination("/c/events/rush-recap?utm_source=email")).toBe(
      "/c/events/rush-recap?utm_source=email"
    );
  });

  it("drops a missing destination", () => {
    expect(sanitizeDestination(null)).toBeNull();
    expect(sanitizeDestination("")).toBeNull();
  });

  it("rejects an absolute URL", () => {
    expect(sanitizeDestination("https://evil.example/phish")).toBeNull();
    expect(sanitizeDestination("http://evil.example/phish")).toBeNull();
  });

  it("rejects a protocol-relative URL", () => {
    expect(sanitizeDestination("//evil.example/phish")).toBeNull();
  });

  it("rejects a backslash host, which browsers normalize to //", () => {
    expect(sanitizeDestination("/\\evil.example")).toBeNull();
    expect(sanitizeDestination("\\\\evil.example")).toBeNull();
  });

  it("rejects a bare path with no leading slash", () => {
    expect(sanitizeDestination("c/events/rush-recap")).toBeNull();
  });

  it("rejects control characters that would split the Location header", () => {
    expect(sanitizeDestination("/c/events\r\nLocation: https://evil.example")).toBeNull();
    expect(sanitizeDestination("/c/events\nfoo")).toBeNull();
  });

  it("rejects percent-encoded CR/LF", () => {
    expect(sanitizeDestination("/c/events%0d%0aLocation:+https://evil.example")).toBeNull();
    expect(sanitizeDestination("/c/events%0A")).toBeNull();
  });
});

describe("communityOriginFromTemplate", () => {
  it("derives the community origin from the cookie-exchange template", () => {
    expect(
      communityOriginFromTemplate(
        "https://memberspace.campusstores.ca/session/cookies?access_token={token}"
      )
    ).toBe("https://memberspace.campusstores.ca");
  });

  it("returns null when the template is blank, which is how production sat for months", () => {
    expect(communityOriginFromTemplate("")).toBeNull();
    expect(communityOriginFromTemplate(undefined)).toBeNull();
  });

  it("returns null for an unparseable template rather than throwing", () => {
    expect(communityOriginFromTemplate("not a url {token}")).toBeNull();
  });
});

describe("escapeHtmlAttribute", () => {
  it("neutralises a quote break-out in an interpolated attribute", () => {
    expect(escapeHtmlAttribute('" onload="alert(1)')).toBe(
      "&quot; onload=&quot;alert(1)"
    );
  });

  it("escapes angle brackets and ampersands", () => {
    expect(escapeHtmlAttribute("a&b<script>")).toBe("a&amp;b&lt;script&gt;");
  });
});

describe("renderBridgeInterstitial", () => {
  const html = renderBridgeInterstitial(
    "https://memberspace.campusstores.ca/session/cookies?access_token=tok",
    "https://memberspace.campusstores.ca/c/announcements-f3687d/a-post"
  );

  it("loads the cookie exchange in a frame, not a fetch (Circle sends no CORS headers)", () => {
    expect(html).toContain(
      'iframe src="https://memberspace.campusstores.ca/session/cookies?access_token=tok"'
    );
  });

  it("navigates to the destination once the frame settles", () => {
    expect(html).toContain('"https://memberspace.campusstores.ca/c/announcements-f3687d/a-post"');
    expect(html).toContain("window.location.replace(dest)");
  });

  it("keeps a no-JS path to the destination", () => {
    expect(html).toMatch(/<noscript>[\s\S]*a-post/);
  });

  it("JSON-encodes the destination so it cannot break out of the script", () => {
    const nasty = renderBridgeInterstitial("https://x.test/e", 'https://x.test/</script><script>alert(1)');
    expect(nasty).not.toContain("</script><script>alert(1)");
  });
});
