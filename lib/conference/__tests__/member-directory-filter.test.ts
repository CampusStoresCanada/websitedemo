import { describe, expect, it } from "vitest";
import { filterListings, type DirectoryListing } from "../member-directory-filter";

const listing = (over: Partial<DirectoryListing>): DirectoryListing => ({
  orgId: over.name ?? "id", name: "Acme", slug: "acme", logoUrl: null,
  description: null, booths: [], departments: [], classes: [], people: [], ...over,
});

const FLOOR: DirectoryListing[] = [
  listing({ name: "Boxercraft", booths: ["305"], departments: ["Apparel"] }),
  listing({ name: "Sock Rocket", booths: ["5"], departments: ["Apparel", "Accessories"] }),
  listing({ name: "Merangue", booths: ["105", "502"], departments: ["School Office & Lab Supplies"] }),
  listing({ name: "Roots", booths: [], departments: ["Apparel"], description: "Leather goods and outerwear" }),
];

describe("directory filtering", () => {
  it("finds a company by name", () => {
    expect(filterListings(FLOOR, "boxer", new Set()).map((l) => l.name)).toEqual(["Boxercraft"]);
  });

  it("finds a company by what it sells, not just its name", () => {
    expect(filterListings(FLOOR, "outerwear", new Set()).map((l) => l.name)).toEqual(["Roots"]);
  });

  it("matches a booth number WHOLE, never partially", () => {
    // Now lib/explore's rule, shared with the map and the partners page.
    // Someone holding a printed floor plan types the number they can see.
    expect(filterListings(FLOOR, "5", new Set()).map((l) => l.name)).toEqual(["Sock Rocket"]);
    expect(filterListings(FLOOR, "305", new Set()).map((l) => l.name)).toEqual(["Boxercraft"]);
    expect(filterListings(FLOOR, "30", new Set())).toEqual([]);
  });

  it("treats several chips as OR, never AND", () => {
    // Two aisles, not the companies that sell both. The intersection here is
    // empty, which would look like a broken filter.
    const both = filterListings(FLOOR, "", new Set(["Accessories", "School Office & Lab Supplies"]));
    expect(both.map((l) => l.name).sort()).toEqual(["Merangue", "Sock Rocket"]);
  });

  it("narrows chips by the search box as well", () => {
    const r = filterListings(FLOOR, "sock", new Set(["Apparel"]));
    expect(r.map((l) => l.name)).toEqual(["Sock Rocket"]);
  });

  it("shows everything when nothing is asked for", () => {
    expect(filterListings(FLOOR, "   ", new Set())).toHaveLength(4);
  });

  it("keeps a company with no booth reachable by name", () => {
    // Sponsors and partners without floor space still belong in the list.
    expect(filterListings(FLOOR, "roots", new Set()).map((l) => l.name)).toEqual(["Roots"]);
  });
});
