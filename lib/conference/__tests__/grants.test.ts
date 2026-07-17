import { describe, expect, it } from "vitest";

import {
  collectDataObligations,
  GRANT_TYPE_DEFINITIONS,
  GRANT_TYPES,
  validateGrantInput,
  validateGrantScopes,
  type GrantInput,
  type GrantScopeCatalog,
} from "../grants";

function grant(overrides: Partial<GrantInput>): GrantInput {
  return {
    grantType: "day_access",
    quantity: 1,
    per: "order",
    scopeMode: "all",
    ...overrides,
  };
}

const CATALOG: GrantScopeCatalog = {
  dayIds: new Set(["day-1", "day-2"]),
  elementIds: new Set(["meal-1", "session-1", "offsite-1"]),
  boothIds: new Set(["booth-1"]),
};

describe("grant vocabulary", () => {
  it("defines every grant type", () => {
    for (const type of GRANT_TYPES) {
      expect(GRANT_TYPE_DEFINITIONS[type]).toBeDefined();
      expect(GRANT_TYPE_DEFINITIONS[type].label.length).toBeGreaterThan(0);
    }
  });
});

describe("validateGrantInput", () => {
  it("accepts a plain scope-all day access grant", () => {
    expect(validateGrantInput(grant({}))).toEqual([]);
  });

  it("accepts a booth package shape: booth_space + selected days with kinds", () => {
    expect(validateGrantInput(grant({ grantType: "booth_space" }))).toEqual([]);
    expect(
      validateGrantInput(
        grant({
          scopeMode: "selected",
          dayScopes: [
            { dayId: "day-1", accessKind: "move_in" },
            { dayId: "day-2", accessKind: "floor" },
          ],
        })
      )
    ).toEqual([]);
  });

  it("requires a registration type on badge seats", () => {
    const errors = validateGrantInput(grant({ grantType: "badge_seat", quantity: 3 }));
    expect(errors.some((e) => e.includes("registration type"))).toBe(true);

    expect(
      validateGrantInput(
        grant({ grantType: "badge_seat", quantity: 3, scopeRegistrationType: "exhibitor" })
      )
    ).toEqual([]);
  });

  it("rejects registration type on grants that do not use it", () => {
    const errors = validateGrantInput(grant({ scopeRegistrationType: "delegate" }));
    expect(errors.some((e) => e.includes("does not apply"))).toBe(true);
  });

  it("requires a specific offsite event for offsite seats", () => {
    const allScoped = validateGrantInput(grant({ grantType: "offsite_seat" }));
    expect(allScoped.some((e) => e.includes("requires a specific scope"))).toBe(true);

    const selectedWithoutEvent = validateGrantInput(
      grant({ grantType: "offsite_seat", scopeMode: "selected" })
    );
    expect(selectedWithoutEvent.some((e) => e.includes("select an element"))).toBe(true);

    expect(
      validateGrantInput(
        grant({
          grantType: "offsite_seat",
          scopeMode: "selected",
          scopeElementId: "offsite-1",
        })
      )
    ).toEqual([]);
  });

  it("rejects non-positive and fractional quantities", () => {
    expect(validateGrantInput(grant({ quantity: 0 }))).not.toEqual([]);
    expect(validateGrantInput(grant({ quantity: -2 }))).not.toEqual([]);
    expect(validateGrantInput(grant({ quantity: 1.5 }))).not.toEqual([]);
  });

  it("requires a non-empty selection in selected mode", () => {
    const errors = validateGrantInput(grant({ scopeMode: "selected" }));
    expect(errors.some((e) => e.includes("at least one day"))).toBe(true);

    const mealErrors = validateGrantInput(
      grant({ grantType: "meal_access", scopeMode: "selected" })
    );
    expect(mealErrors.some((e) => e.includes("at least one element"))).toBe(true);
  });

  it("rejects scope payloads that do not match the grant type", () => {
    const errors = validateGrantInput(
      grant({ grantType: "meal_access", elementIds: ["meal-1"], dayScopes: [{ dayId: "day-1", accessKind: "floor" }] })
    );
    expect(errors.some((e) => e.includes("day scopes do not apply"))).toBe(true);
  });

  it("rejects unknown day access kinds", () => {
    const errors = validateGrantInput(
      grant({
        scopeMode: "selected",
        dayScopes: [{ dayId: "day-1", accessKind: "vip" as never }],
      })
    );
    expect(errors.some((e) => e.includes("invalid day access kind"))).toBe(true);
  });
});

describe("validateGrantScopes", () => {
  it("accepts scopes that exist in the conference catalog", () => {
    expect(
      validateGrantScopes(
        grant({
          scopeMode: "selected",
          dayScopes: [{ dayId: "day-1", accessKind: "floor" }],
        }),
        CATALOG
      )
    ).toEqual([]);
  });

  it("rejects scope ids from outside the conference", () => {
    const errors = validateGrantScopes(
      grant({
        scopeMode: "selected",
        dayScopes: [{ dayId: "day-other-conference", accessKind: "floor" }],
      }),
      CATALOG
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("not part of this conference");
  });

  it("rejects element/booth ids not in the catalog", () => {
    expect(
      validateGrantScopes(
        grant({ grantType: "offsite_seat", scopeMode: "selected", scopeElementId: "nope" }),
        CATALOG
      )
    ).toHaveLength(1);
    expect(
      validateGrantScopes(
        grant({ grantType: "booth_space", scopeBoothId: "nope" }),
        CATALOG
      )
    ).toHaveLength(1);
    expect(
      validateGrantScopes(
        grant({ grantType: "meal_access", scopeMode: "selected", elementIds: ["nope"] }),
        CATALOG
      )
    ).toHaveLength(1);
    expect(
      validateGrantScopes(
        grant({ grantType: "education_access", scopeMode: "selected", elementIds: ["nope"] }),
        CATALOG
      )
    ).toHaveLength(1);
  });
});

describe("collectDataObligations", () => {
  it("unions obligations across grant types without duplicates", () => {
    const obligations = collectDataObligations(["badge_seat", "offsite_seat", "meal_access"]);
    const keys = obligations.map((o) => o.key);

    expect(keys).toContain("display_name");
    expect(keys).toContain("emergency_contact_name");
    // dietary_restrictions appears in both offsite_seat and meal_access — once only
    expect(keys.filter((k) => k === "dietary_restrictions")).toHaveLength(1);
  });

  it("returns nothing for access-only grants", () => {
    expect(collectDataObligations(["day_access", "booth_space"])).toEqual([]);
  });
});
