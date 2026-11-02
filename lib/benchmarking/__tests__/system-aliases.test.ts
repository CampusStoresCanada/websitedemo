import { describe, it, expect } from "vitest";
import {
  canonicalSystem,
  canonicalSystems,
  SYSTEM_ALIAS_GROUPS,
} from "../system-aliases";
import { FIELD_REGISTRY } from "../field-registry";

describe("canonicalSystem", () => {
  it("renders the Prism eras down to one product", () => {
    for (const filed of ["Prism", "PrismRBS", "PrismPOS - MOSAIC"]) {
      expect(canonicalSystem("pos_system", filed)).toBe("Prism");
    }
  });

  it("renders the WISL spellings down to one vendor", () => {
    for (const filed of ["WISL", "Waterloo Information Systems Limited"]) {
      expect(canonicalSystem("pos_system", filed)).toBe("Waterloo Information Systems (WISL)");
    }
  });

  it("renders the Netsuite spellings down to one vendor", () => {
    for (const filed of ["Netsuite", "Oracle Netsuite"]) {
      expect(canonicalSystem("pos_system", filed)).toBe("NetSuite");
    }
  });

  it("ignores casing and extra whitespace, since these arrive as free text", () => {
    expect(canonicalSystem("pos_system", "  oracle   netsuite ")).toBe("NetSuite");
    expect(canonicalSystem("pos_system", "wisl")).toBe("Waterloo Information Systems (WISL)");
  });

  it("passes an unknown system through untouched rather than guessing", () => {
    // Steve has not ruled on this one; it must not be folded into "Built in house".
    expect(canonicalSystem("pos_system", "in house - webservices")).toBe("in house - webservices");
    expect(canonicalSystem("pos_system", "Ratex")).toBe("Ratex");
  });

  it("does not alias fields that have no confirmed grouping", () => {
    expect(canonicalSystem("lms_system", "Canvas")).toBe("Canvas");
    expect(canonicalSystem("ebook_delivery_system", "VitalSource")).toBe("VitalSource");
  });

  it("never folds Prism into PrismRBS by prefix — matching is exact, not fuzzy", () => {
    // A hypothetical unrelated product starting with the same letters stays itself.
    expect(canonicalSystem("pos_system", "Prismatic Retail")).toBe("Prismatic Retail");
  });
});

describe("canonicalSystems", () => {
  it("returns null for null, so 'never answered' stays distinct from 'answered nothing'", () => {
    expect(canonicalSystems("pos_system", null)).toBeNull();
  });

  it("keeps an empty answer empty", () => {
    expect(canonicalSystems("pos_system", [])).toEqual([]);
  });

  it("de-duplicates what collapsing creates, so one store is not counted twice", () => {
    // A store that filed two eras of Prism runs one platform.
    expect(canonicalSystems("pos_system", ["Prism", "PrismRBS"])).toEqual(["Prism"]);
  });

  it("preserves two genuinely different platforms", () => {
    expect(canonicalSystems("pos_system", ["Netsuite", "Lightspeed"])).toEqual([
      "NetSuite",
      "Lightspeed",
    ]);
  });

  it("preserves order of first appearance so display stays stable", () => {
    expect(canonicalSystems("pos_system", ["Lightspeed", "Oracle Netsuite"])).toEqual([
      "Lightspeed",
      "NetSuite",
    ]);
  });

  it("drops blank entries rather than rendering an empty chip", () => {
    expect(canonicalSystems("pos_system", ["", "   ", "MBS"])).toEqual(["MBS"]);
  });
});

describe("vocabulary is single-sourced", () => {
  it("every canonical label is an option the survey actually offers", () => {
    // If these drift, fill time steers stores onto a label that read time then
    // renames — which is how a second vocabulary gets started.
    const options = FIELD_REGISTRY.pos_system.options ?? [];
    for (const group of SYSTEM_ALIAS_GROUPS.pos_system) {
      expect(options).toContain(group.canonical);
    }
  });

  it("lists the canonical spelling among its own variants", () => {
    for (const groups of Object.values(SYSTEM_ALIAS_GROUPS)) {
      for (const group of groups) {
        expect(group.variants).toContain(group.canonical);
      }
    }
  });
});
