import { describe, it, expect } from "vitest";
import { pathSignal, viewText } from "../page-view";

describe("pathSignal", () => {
  it("keeps an ordinary member-facing page", () => {
    expect(pathSignal("/directory/merangue")).toEqual({ path: "/directory/merangue", facet: null });
  });

  it("never records admin", () => {
    // Staff at work is not a store expressing what it buys.
    expect(pathSignal("/admin")).toBeNull();
    expect(pathSignal("/admin/conference/badges")).toBeNull();
  });

  it("does not mistake a real route for a forbidden prefix", () => {
    // "/apply" starts with "/ap"… and a careless startsWith("/api") would eat it.
    // It is a live route on this site.
    expect(pathSignal("/apply")).not.toBeNull();
    expect(pathSignal("/apply/partner")).not.toBeNull();
    expect(pathSignal("/api/search/partners")).toBeNull();
  });

  it("drops machinery, assets and auth", () => {
    for (const p of [
      "/_next/static/chunk.js",
      "/auth/callback",
      "/login",
      "/email-preferences",
      "/logo.png",
      "/toolkit/export.csv",
    ]) {
      expect(pathSignal(p), p).toBeNull();
    }
  });

  it("treats a trailing slash as the same page", () => {
    expect(pathSignal("/directory/")).toEqual(pathSignal("/directory"));
    expect(pathSignal("/")?.path).toBe("/");
  });

  it("keeps an allow-listed parameter and discards everything else", () => {
    expect(pathSignal("/directory?category=apparel")).toEqual({
      path: "/directory",
      facet: "apparel",
    });
    // ⛔ Allow-list, not block-list: a token must never survive by not having
    // been thought of.
    expect(pathSignal("/directory?token=abc123&email=a@b.ca")).toEqual({
      path: "/directory",
      facet: null,
    });
  });

  it("truncates a pasted query rather than storing it whole", () => {
    const long = "x".repeat(500);
    expect(pathSignal(`/search?q=${long}`)!.facet!.length).toBeLessThanOrEqual(120);
  });

  it("accepts a full URL as readily as a path", () => {
    expect(pathSignal("https://www.campusstores.ca/directory/merangue")?.path).toBe(
      "/directory/merangue"
    );
  });

  it("returns null rather than throwing on nonsense", () => {
    expect(pathSignal("")).toBeNull();
    expect(pathSignal("not a url at all")).toBeNull();
  });
});

describe("viewText", () => {
  it("turns a slug path into words an embedder can read", () => {
    expect(viewText({ path: "/directory/campus-outfitters", facet: null })).toBe(
      "directory campus outfitters"
    );
  });

  it("appends the facet, so a filtered browse says what was filtered", () => {
    expect(viewText({ path: "/directory", facet: "apparel" })).toBe("directory apparel");
  });

  it("strips opaque identifiers, which embed to noise", () => {
    expect(viewText({ path: "/events/3fa85f64-5717-4562-b3fc-2c963f66afa6", facet: null })).toBe(
      "events"
    );
    expect(viewText({ path: "/conference/2027/booth/41", facet: null })).toBe("conference booth");
  });

  it("returns null when nothing meaningful survives", () => {
    // A path of pure ids would otherwise contribute a direction made of nothing.
    expect(viewText({ path: "/3fa85f64-5717-4562-b3fc-2c963f66afa6", facet: null })).toBeNull();
    expect(viewText({ path: "/", facet: null })).toBeNull();
  });
});
