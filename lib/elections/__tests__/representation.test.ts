import { describe, it, expect } from "vitest";
import {
  titleCaseProvince,
  deriveInstitutionType,
  resolveInstitutionType,
  resolveRegion,
  resolveSizeBand,
  buildRepresentationSnapshot,
  type OrgProfile,
} from "../representation";

const org = (over: Partial<OrgProfile> & { name: string }): OrgProfile => ({
  organizationId: over.name,
  province: "ON",
  fte: 10_000,
  institutionTypeConfirmed: null,
  ...over,
});

describe("institution type", () => {
  it("reads the common Canadian forms", () => {
    expect(deriveInstitutionType("McGill University")).toBe("university");
    expect(deriveInstitutionType("Algonquin College")).toBe("college");
    expect(deriveInstitutionType("Université de Montréal")).toBe("university");
    expect(deriveInstitutionType("Cégep de Sainte-Foy")).toBe("college");
    expect(deriveInstitutionType("British Columbia Institute of Technology")).toBe("institute");
    expect(deriveInstitutionType("Northern Alberta Institute of Technology")).toBe("institute");
  });

  it("puts polytechnic ahead of the other matches", () => {
    // "Kwantlen Polytechnic University" contains both — polytechnic is the
    // more specific fact and wins.
    expect(deriveInstitutionType("Kwantlen Polytechnic University")).toBe("polytechnic");
  });

  it("falls back to other rather than guessing", () => {
    expect(deriveInstitutionType("The Campus Store")).toBe("other");
  });

  it("lets a confirmed value beat the guess, and says which it used", () => {
    expect(resolveInstitutionType("The Campus Store", "college")).toEqual({ value: "college", confirmed: true });
    expect(resolveInstitutionType("McGill University", null)).toEqual({ value: "university", confirmed: false });
  });
});

describe("region", () => {
  it("splits at Manitoba per by-law definitions (g) and (q)", () => {
    expect(resolveRegion("MB")).toBe("western");
    expect(resolveRegion("BC")).toBe("western");
    expect(resolveRegion("ON")).toBe("eastern");
    expect(resolveRegion("NL")).toBe("eastern");
    expect(resolveRegion(null)).toBe("unknown");
  });

  it("handles the FULL NAMES the database actually stores", () => {
    // organizations.province holds "British Columbia", not "BC". Assuming codes
    // sorted all 19 eligible members into "unknown" without erroring — the
    // breakdown was empty, not wrong-looking.
    expect(resolveRegion("British Columbia")).toBe("western");
    expect(resolveRegion("Alberta")).toBe("western");
    expect(resolveRegion("Manitoba")).toBe("western");
    expect(resolveRegion("Saskatchewan")).toBe("western");
    expect(resolveRegion("Yukon")).toBe("western");
    expect(resolveRegion("Ontario")).toBe("eastern");
    expect(resolveRegion("Quebec")).toBe("eastern");
    expect(resolveRegion("New Brunswick")).toBe("eastern");
    expect(resolveRegion("Nova Scotia")).toBe("eastern");
    expect(resolveRegion("Prince Edward Island")).toBe("eastern");
    expect(resolveRegion("Newfoundland and Labrador")).toBe("eastern");
  });

  it("covers every province present in the live data", () => {
    const live = [
      "Alberta", "British Columbia", "Manitoba", "New Brunswick",
      "Newfoundland and Labrador", "Nova Scotia", "Ontario",
      "Prince Edward Island", "Quebec", "Saskatchewan", "Yukon",
    ];
    expect(live.filter((p) => resolveRegion(p) === "unknown")).toEqual([]);
  });

  it("accepts French names", () => {
    expect(resolveRegion("Québec")).toBe("eastern");
    expect(resolveRegion("Colombie-Britannique")).toBe("western");
  });

  it("says unknown rather than guessing", () => {
    expect(resolveRegion("Californie")).toBe("unknown");
  });
});

describe("province display", () => {
  it("title-cases the stored value", () => {
    expect(titleCaseProvince("BRITISH COLUMBIA")).toBe("British Columbia");
    expect(titleCaseProvince("prince edward island")).toBe("Prince Edward Island");
  });
});

describe("size bands", () => {
  it("bands by FTE and keeps null as unknown", () => {
    expect(resolveSizeBand(2_000)).toBe("small");
    expect(resolveSizeBand(5_000)).toBe("medium");
    expect(resolveSizeBand(19_999)).toBe("medium");
    expect(resolveSizeBand(20_000)).toBe("large");
    expect(resolveSizeBand(null)).toBeNull();
  });
});

describe("representation snapshot", () => {
  const membership = [
    org({ name: "A University", province: "ON", fte: 30_000 }),
    org({ name: "B College", province: "BC", fte: 3_000 }),
    org({ name: "C University", province: "NS", fte: 8_000 }),
    org({ name: "D College", province: "AB", fte: 2_000 }),
  ];

  it("shows the nominee pool against the membership it is drawn from", () => {
    const snapshot = buildRepresentationSnapshot([membership[0], membership[2]], membership);
    expect(snapshot.nomineeCount).toBe(2);
    expect(snapshot.eligibleOrgCount).toBe(4);

    const type = snapshot.dimensions.find((d) => d.key === "institution_type")!;
    expect(type.nominees).toEqual({ university: 2 });
    expect(type.membership).toEqual({ university: 2, college: 2 });
    expect(type.unrepresented).toEqual(["college"]);
  });

  it("names an unrepresented region", () => {
    const snapshot = buildRepresentationSnapshot([membership[0]], membership);
    const region = snapshot.dimensions.find((d) => d.key === "region")!;
    expect(region.unrepresented).toEqual(["western"]);
  });

  it("flags when a dimension is standing on derived guesses", () => {
    const snapshot = buildRepresentationSnapshot([membership[0]], membership);
    expect(snapshot.dimensions.find((d) => d.key === "institution_type")!.containsDerivedValues).toBe(true);

    const confirmed = membership.map((o) => ({ ...o, institutionTypeConfirmed: "university" }));
    const s2 = buildRepresentationSnapshot([confirmed[0]], confirmed);
    expect(s2.dimensions.find((d) => d.key === "institution_type")!.containsDerivedValues).toBe(false);
  });

  it("counts an institution once but reports its multiple nominees", () => {
    const snapshot = buildRepresentationSnapshot([membership[0], membership[0], membership[1]], membership);
    expect(snapshot.nomineeCount).toBe(3);
    expect(snapshot.nomineeOrgCount).toBe(2);
    expect(snapshot.orgsWithMultipleNominees).toEqual([
      { organizationId: "A University", name: "A University", count: 2 },
    ]);
  });
});
