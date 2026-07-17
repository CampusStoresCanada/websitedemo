import { describe, expect, it } from "vitest";

import { computePersonObligations } from "../access";

describe("computePersonObligations", () => {
  it("owes nothing for access-only grants", () => {
    const status = computePersonObligations(["day_access", "booth_space"], {});
    expect(status.obligations).toEqual([]);
    expect(status.isReady).toBe(true);
  });

  it("derives badge obligations and flags the missing ones", () => {
    const status = computePersonObligations(["badge_seat"], {
      display_name: "Jordan Lee",
      contact_email: "",
    });
    const missingKeys = status.missing.map((o) => o.key);
    expect(missingKeys).toEqual(["contact_email"]);
    expect(status.isReady).toBe(false);
  });

  it("owes emergency contact + dietary because of an offsite seat, not role", () => {
    const status = computePersonObligations(["offsite_seat"], {
      dietary_restrictions: "Vegetarian",
      accessibility_needs: null,
      emergency_contact_name: "Sam",
      emergency_contact_phone: "555-1234",
    });
    expect(status.missing.map((o) => o.key)).toEqual(["accessibility_needs"]);
  });

  it("treats empty arrays and whitespace as missing", () => {
    const status = computePersonObligations(["badge_seat"], {
      display_name: "   ",
      contact_email: "a@b.test",
    });
    expect(status.missing.map((o) => o.key)).toEqual(["display_name"]);
  });

  it("dedupes obligations shared across grant types (dietary)", () => {
    const status = computePersonObligations(["offsite_seat", "meal_access"], {});
    expect(status.obligations.filter((o) => o.key === "dietary_restrictions")).toHaveLength(1);
  });
});
