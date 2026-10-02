import { describe, it, expect } from "vitest";
import {
  REQUEST_PATHNAME_HEADER,
  REQUEST_SEARCH_HEADER,
  loginPathFromHeaders,
  needsRequestPathStamp,
} from "../request-path";

/**
 * The regression this pins down: app/admin/layout.tsx gates every page under
 * /admin and fires before each page's own guard. Next tells a layout nothing
 * about the child path, so the layout sent everyone to /admin and the exact
 * loginWithNext("/admin/renewals") that page makes for itself was dead code.
 * proxy.ts now stamps the path; this is the reader.
 */
function stamp(pathname?: string, search?: string): Headers {
  const headers = new Headers();
  if (pathname !== undefined) headers.set(REQUEST_PATHNAME_HEADER, pathname);
  if (search !== undefined) headers.set(REQUEST_SEARCH_HEADER, search);
  return headers;
}

describe("loginPathFromHeaders", () => {
  it("returns the page they actually asked for, not the area", () => {
    expect(loginPathFromHeaders(stamp("/admin/renewals"), "/admin")).toBe(
      "/login?next=%2Fadmin%2Frenewals",
    );
  });

  it("keeps a nested path whole", () => {
    expect(
      loginPathFromHeaders(stamp("/admin/comms/templates/new"), "/admin"),
    ).toBe("/login?next=%2Fadmin%2Fcomms%2Ftemplates%2Fnew");
  });

  it("carries the query, encoded once, as a single next param", () => {
    const result = loginPathFromHeaders(
      stamp("/admin/renewals", "?focus=overdue"),
      "/admin",
    );
    expect(result).toBe("/login?next=%2Fadmin%2Frenewals%3Ffocus%3Doverdue");
    // Decoding once has to give back a usable relative destination, because
    // that single decode is all LoginForm does with it.
    const next = new URLSearchParams(result.split("?")[1]).get("next");
    expect(next).toBe("/admin/renewals?focus=overdue");
  });

  it("keeps every value of a repeated param", () => {
    const result = loginPathFromHeaders(
      stamp("/admin/comms/campaigns/new", "?tag=a&tag=b"),
      "/admin",
    );
    const next = new URLSearchParams(result.split("?")[1]).get("next");
    expect(next).toBe("/admin/comms/campaigns/new?tag=a&tag=b");
  });

  it("falls back when the stamp is missing", () => {
    // A request that reached the layout without passing the proxy matcher.
    expect(loginPathFromHeaders(stamp(), "/admin")).toBe(
      "/login?next=%2Fadmin",
    );
    expect(loginPathFromHeaders(stamp("", ""), "/admin")).toBe(
      "/login?next=%2Fadmin",
    );
  });

  it("refuses anything that is not a plain relative path", () => {
    // ⛔ The open-redirect guard. proxy.ts sets rather than appends, so a
    // client cannot land its own value here on an /admin path — this is the
    // second line, not the first.
    for (const hostile of [
      "//evil.example.com",
      "https://evil.example.com/admin",
      "admin/renewals",
      "\\\\evil.example.com",
    ]) {
      expect(loginPathFromHeaders(stamp(hostile), "/admin")).toBe(
        "/login?next=%2Fadmin",
      );
    }
  });
});

describe("needsRequestPathStamp", () => {
  it("covers both areas whose gate lives in a layout", () => {
    expect(needsRequestPathStamp("/admin")).toBe(true);
    expect(needsRequestPathStamp("/admin/renewals")).toBe(true);
    expect(needsRequestPathStamp("/benchmarking/admin")).toBe(true);
    // ⛔ The Circle flag DM's destination. Dropping /issues here is what made
    // the link look like login had thrown it away.
    expect(needsRequestPathStamp("/benchmarking/admin/issues")).toBe(true);
  });

  it("leaves the rest of the site alone", () => {
    // These gate in the page, which already knows its own path.
    for (const path of [
      "/",
      "/me",
      "/benchmarking",
      "/benchmarking/survey",
      "/benchmarking/review",
      "/org/langara/admin",
    ]) {
      expect(needsRequestPathStamp(path)).toBe(false);
    }
  });

  it("does not match a prefix that is only a string prefix", () => {
    // /administration would be a different route, not the admin area.
    expect(needsRequestPathStamp("/administration")).toBe(false);
    expect(needsRequestPathStamp("/admin-tools")).toBe(false);
  });
});
