import { describe, expect, it } from "vitest";
import { parsePublication, type StoredPublicationRow } from "../store";

const row = (over: Partial<StoredPublicationRow> = {}): StoredPublicationRow => ({
  id: "p1",
  name: "CSC 2027 Directory",
  title: "Campus Stores Conference 2027 — Directory",
  source: { kind: "conference", conferenceId: "conf-1" },
  selection: {},
  sections: [{ type: "listings", groupBy: "category", title: "Exhibitors" }],
  ...over,
});

describe("parsePublication — valid definitions", () => {
  it("round-trips a conference directory", () => {
    const r = parsePublication(row())!;
    expect(r.publication.source).toEqual({ kind: "conference", conferenceId: "conf-1" });
    expect(r.publication.sections).toEqual([{ type: "listings", groupBy: "category", title: "Exhibitors" }]);
    expect(r.rejected).toEqual([]);
  });

  it("reads an organizations source, so a publication need not be a conference", () => {
    const r = parsePublication(row({ source: { kind: "organizations", orgType: "Vendor Partner" } }))!;
    expect(r.publication.source).toEqual({ kind: "organizations", orgType: "Vendor Partner" });
  });

  it("keeps only real selection values, ignoring junk", () => {
    const r = parsePublication(row({
      selection: { departments: ["Apparel", 42], printReadyOnly: "yes", orgIds: ["a"] },
    }))!;
    expect(r.publication.selection.departments).toEqual(["Apparel"]);
    expect(r.publication.selection.orgIds).toEqual(["a"]);
    // A non-boolean must not be coerced into "true" and silently drop listings.
    expect(r.publication.selection.printReadyOnly).toBeUndefined();
  });
});

describe("parsePublication — nothing is dropped silently", () => {
  it("rejects a listings section with no groupBy, and says so", () => {
    // Printing in an arbitrary order is worse than being told it was ignored.
    const r = parsePublication(row({ sections: [{ type: "listings", title: "Exhibitors" }] }))!;
    expect(r.publication.sections).toEqual([]);
    expect(r.rejected.join(" ")).toContain("groupBy");
  });

  it("rejects an unknown section type by name", () => {
    const r = parsePublication(row({ sections: [{ type: "advertisement" }] }))!;
    expect(r.rejected.join(" ")).toContain("advertisement");
  });

  it("keeps the good sections when one is bad", () => {
    const r = parsePublication(row({
      sections: [
        { type: "category_index" },
        { type: "listings" },
        { type: "booth_index", title: "By Booth" },
      ],
    }))!;
    expect(r.publication.sections.map((s) => s.type)).toEqual(["category_index", "booth_index"]);
    expect(r.rejected).toHaveLength(1);
  });

  it("requires a static section to have both title and body", () => {
    const r = parsePublication(row({ sections: [{ type: "static", title: "Welcome" }] }))!;
    expect(r.publication.sections).toEqual([]);
    expect(r.rejected.join(" ")).toContain("title and a body");
  });

  it("reports a non-array sections field rather than throwing", () => {
    const r = parsePublication(row({ sections: { type: "listings" } }))!;
    expect(r.publication.sections).toEqual([]);
    expect(r.rejected.join(" ")).toContain("not an array");
  });
});

describe("parsePublication — unpublishable definitions", () => {
  it("returns null without a usable source: there is nothing to publish", () => {
    expect(parsePublication(row({ source: { kind: "conference" } }))).toBeNull();
    expect(parsePublication(row({ source: { kind: "nonsense" } }))).toBeNull();
    expect(parsePublication(row({ source: "conference" }))).toBeNull();
    expect(parsePublication(row({ source: null }))).toBeNull();
  });
});
