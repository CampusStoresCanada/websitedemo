import { describe, expect, it } from "vitest";

import type { HomeMapOrg } from "../../homepage";
import { orgMatchesQuery } from "../org-search";

function org(overrides: Partial<HomeMapOrg> = {}): HomeMapOrg {
  return {
    id: "1",
    slug: "acme",
    name: "Acme Supply",
    type: "Vendor Partner",
    city: "Guelph",
    province: "Ontario",
    latitude: null,
    longitude: null,
    logoUrl: null,
    website: null,
    primaryCategory: null,
    organizationType: null,
    fte: null,
    enrollmentFte: null,
    posSystem: null,
    servicesOffered: null,
    operationsMandate: null,
    numLocations: null,
    totalSquareFootage: null,
    paymentOptions: null,
    shoppingServices: null,
    lmsSystem: null,
    socialMediaPlatforms: null,
    institutionType: null,
    fulltimeEmployees: null,
    companyDescription: null,
    highlightProductName: null,
    catalogueUrl: null,
    certifications: [],
    isCancollMember: false,
    procurementCategories: [],
    preferredCertifications: [],
    buyingWindow: null,
    ...overrides,
  };
}

describe("orgMatchesQuery", () => {
  it("still matches name, city and province", () => {
    const o = org();
    expect(orgMatchesQuery(o, "acme")).toBe(true);
    expect(orgMatchesQuery(o, "guelph")).toBe(true);
    expect(orgMatchesQuery(o, "ontario")).toBe(true);
    expect(orgMatchesQuery(o, "zzz")).toBe(false);
  });

  it("finds an exhibitor by their booth number", () => {
    const o = org({ exhibitorBooths: ["402"] });
    expect(orgMatchesQuery(o, "402")).toBe(true);
    expect(orgMatchesQuery(o, "booth 402")).toBe(true);
    expect(orgMatchesQuery(o, "Booths 402")).toBe(true);
  });

  it("matches booth numbers WHOLE, so a prefix does not drag in every neighbour", () => {
    // The point of the rule: someone reading "402" off a printed floor plan
    // wants one answer, not booths 40 / 400 / 402 / 408 at once.
    const o = org({ exhibitorBooths: ["402"] });
    expect(orgMatchesQuery(o, "40")).toBe(false);
    expect(orgMatchesQuery(o, "4")).toBe(false);
    expect(orgMatchesQuery(o, "4020")).toBe(false);
  });

  it("handles multi-booth orgs and single-digit booths", () => {
    const o = org({ exhibitorBooths: ["716", "718"] });
    expect(orgMatchesQuery(o, "716")).toBe(true);
    expect(orgMatchesQuery(o, "718")).toBe(true);
    expect(orgMatchesQuery(o, "717")).toBe(false);

    expect(orgMatchesQuery(org({ exhibitorBooths: ["7"] }), "7")).toBe(true);
  });

  it("surfaces every exhibitor for the bare words", () => {
    const exhibitor = org({ exhibitorBooths: ["402"] });
    const notExhibiting = org({ exhibitorBooths: [] });
    for (const word of ["exhibitor", "exhibitors", "exhibiting", "booth", "booths"]) {
      expect(orgMatchesQuery(exhibitor, word)).toBe(true);
      expect(orgMatchesQuery(notExhibiting, word)).toBe(false);
    }
  });

  it("does not match a booth number on an org that holds no booth", () => {
    expect(orgMatchesQuery(org(), "402")).toBe(false);
    expect(orgMatchesQuery(org({ exhibitorBooths: undefined }), "402")).toBe(false);
  });
});
