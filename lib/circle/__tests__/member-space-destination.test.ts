import { describe, it, expect } from "vitest";
import { sanitizeDestination } from "@/app/api/circle/member-space/route";

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
