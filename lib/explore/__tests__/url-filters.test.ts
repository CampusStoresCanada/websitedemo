import { describe, expect, it } from "vitest";

import {
  INTERNATIONAL_PROVINCE,
  parseExploreFilterParams,
  provinceVocabulary,
  resolveProvinceParam,
  resolveSizeParam,
  writeExploreFilterParams,
} from "../url-filters";

/**
 * The province values actually stored on active member orgs (full names, not
 * postal codes) — the vocabulary a param has to resolve into.
 */
const MEMBER_PROVINCES = new Set([
  "Ontario",
  "Alberta",
  "British Columbia",
  "Nova Scotia",
  "New Brunswick",
  "Manitoba",
  "Quebec",
  "Saskatchewan",
  "Prince Edward Island",
  "Newfoundland and Labrador",
]);

describe("resolveProvinceParam", () => {
  it("resolves the two-letter code an email merge variable would supply", () => {
    expect(resolveProvinceParam("ON")).toBe("Ontario");
    expect(resolveProvinceParam("BC")).toBe("British Columbia");
    expect(resolveProvinceParam("NL")).toBe("Newfoundland and Labrador");
  });

  it("resolves the stored full name, and is case / whitespace insensitive", () => {
    expect(resolveProvinceParam("Ontario")).toBe("Ontario");
    expect(resolveProvinceParam("ontario")).toBe("Ontario");
    expect(resolveProvinceParam("  british columbia  ")).toBe("British Columbia");
    expect(resolveProvinceParam("BRITISH   COLUMBIA")).toBe("British Columbia");
    expect(resolveProvinceParam("on")).toBe("Ontario");
  });

  it("resolves common alternate spellings", () => {
    expect(resolveProvinceParam("PEI")).toBe("Prince Edward Island");
    expect(resolveProvinceParam("Newfoundland")).toBe("Newfoundland and Labrador");
    expect(resolveProvinceParam("Québec")).toBe("Quebec");
  });

  it("drops a value that is not a province", () => {
    expect(resolveProvinceParam("ZZ")).toBeUndefined();
    expect(resolveProvinceParam("Ontarioo")).toBeUndefined();
    expect(resolveProvinceParam("Washington")).toBeUndefined();
    expect(resolveProvinceParam("<script>")).toBeUndefined();
    expect(resolveProvinceParam("")).toBeUndefined();
    expect(resolveProvinceParam("   ")).toBeUndefined();
    expect(resolveProvinceParam(null)).toBeUndefined();
    expect(resolveProvinceParam(undefined)).toBeUndefined();
  });

  it("drops a real province that holds no stores in this cohort", () => {
    // Nunavut is a province we can name but have no member in — applying it
    // would strand the reader on an empty list, so it falls back to unfiltered.
    expect(resolveProvinceParam("Nunavut")).toBe("Nunavut");
    expect(resolveProvinceParam("Nunavut", MEMBER_PROVINCES)).toBeUndefined();
    expect(resolveProvinceParam("NU", MEMBER_PROVINCES)).toBeUndefined();
    expect(resolveProvinceParam("ON", MEMBER_PROVINCES)).toBe("Ontario");
  });

  it("passes the outside-Canada sentinel through untouched", () => {
    expect(resolveProvinceParam(INTERNATIONAL_PROVINCE)).toBe(INTERNATIONAL_PROVINCE);
  });
});

describe("resolveSizeParam", () => {
  it("accepts the four scale band keys", () => {
    expect(resolveSizeParam("small")).toBe("small");
    expect(resolveSizeParam("medium")).toBe("medium");
    expect(resolveSizeParam("large")).toBe("large");
    expect(resolveSizeParam("xlarge")).toBe("xlarge");
    expect(resolveSizeParam("XLARGE")).toBe("xlarge");
  });

  it("drops anything else", () => {
    expect(resolveSizeParam("huge")).toBeUndefined();
    expect(resolveSizeParam("5000")).toBeUndefined();
    expect(resolveSizeParam("x-large")).toBeUndefined();
    expect(resolveSizeParam("")).toBeUndefined();
    expect(resolveSizeParam(null)).toBeUndefined();
  });
});

describe("parseExploreFilterParams", () => {
  const opts = { availableProvinces: MEMBER_PROVINCES };

  it("reads province and size together", () => {
    expect(parseExploreFilterParams("?province=ON&size=large", opts)).toEqual({
      province: "Ontario",
      scaleRange: "large",
    });
  });

  it("returns the unfiltered default for a bare URL", () => {
    expect(parseExploreFilterParams("", opts)).toEqual({});
    expect(parseExploreFilterParams("?", opts)).toEqual({});
    expect(parseExploreFilterParams("?utm_source=renewal-email", opts)).toEqual({});
  });

  it("drops only the invalid half of a mixed URL", () => {
    expect(parseExploreFilterParams("?province=ZZ&size=medium", opts)).toEqual({
      scaleRange: "medium",
    });
    expect(parseExploreFilterParams("?province=ON&size=enormous", opts)).toEqual({
      province: "Ontario",
    });
    expect(parseExploreFilterParams("?province=ZZ&size=enormous", opts)).toEqual({});
  });

  it("accepts scaleRange as an alias for size", () => {
    expect(parseExploreFilterParams("?scaleRange=small", opts)).toEqual({ scaleRange: "small" });
    // size wins when both are present
    expect(parseExploreFilterParams("?size=large&scaleRange=small", opts)).toEqual({
      scaleRange: "large",
    });
  });

  it("ignores params it does not own", () => {
    expect(
      parseExploreFilterParams("?province=AB&pos=Nebraska&cancoll=true&mandate=Auxiliary", opts)
    ).toEqual({ province: "Alberta" });
  });

  it("accepts a URLSearchParams as well as a string", () => {
    expect(parseExploreFilterParams(new URLSearchParams({ province: "NS" }), opts)).toEqual({
      province: "Nova Scotia",
    });
  });
});

describe("writeExploreFilterParams", () => {
  it("writes the canonical province name and size key", () => {
    expect(writeExploreFilterParams("", { province: "Ontario", scaleRange: "large" })).toBe(
      "?province=Ontario&size=large"
    );
  });

  it("returns an empty string when nothing is filtered", () => {
    expect(writeExploreFilterParams("", {})).toBe("");
    expect(writeExploreFilterParams("?province=Ontario", {})).toBe("");
  });

  it("preserves params it does not own, so campaign tracking survives", () => {
    expect(
      writeExploreFilterParams("?utm_source=renewal&utm_medium=email", { province: "Alberta" })
    ).toBe("?utm_source=renewal&utm_medium=email&province=Alberta");
  });

  it("replaces a stale value rather than appending a second one", () => {
    expect(writeExploreFilterParams("?province=Ontario&size=small", { province: "Quebec" })).toBe(
      "?province=Quebec"
    );
  });

  it("clears the legacy scaleRange alias when it rewrites", () => {
    expect(writeExploreFilterParams("?scaleRange=small", { scaleRange: "small" })).toBe(
      "?size=small"
    );
  });

  it("does not write the gated or benchmarking-derived filters", () => {
    expect(
      writeExploreFilterParams("", {
        province: "Ontario",
        pos: "Nebraska",
        service: "Textbook rental",
        mandate: "Auxiliary",
        cancoll: "true",
        certification: "CANCOLL",
        category: "Books",
      })
    ).toBe("?province=Ontario");
  });

  it("round-trips through the parser", () => {
    const filters = { province: "British Columbia", scaleRange: "xlarge" } as const;
    const search = writeExploreFilterParams("", filters);
    expect(parseExploreFilterParams(search, { availableProvinces: MEMBER_PROVINCES })).toEqual(
      filters
    );
  });
});

describe("provinceVocabulary", () => {
  it("collects the distinct provinces present, skipping null and Out of Canada", () => {
    const vocab = provinceVocabulary([
      { province: "Ontario" },
      { province: "Ontario" },
      { province: "Alberta" },
      { province: null },
      { province: "Out of Canada" },
    ]);
    expect([...vocab].sort()).toEqual(["Alberta", "Ontario"]);
  });
});
