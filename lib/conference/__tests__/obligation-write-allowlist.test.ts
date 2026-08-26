import { describe, expect, it } from "vitest";
import { computePersonObligations } from "../access";
import { grantTypesForKinds } from "../entity-obligations";

/**
 * The allowlist that decides which columns `saveConferenceObligations` will
 * write is `computePersonObligations(...).obligations`, resolved server-side
 * from the person's own seats. These tests pin the two properties the handler
 * depends on, because the handler itself needs a database.
 *
 * `conference_people` also carries badge_print_status, checked_in_at and
 * assignment_status. If the obligation set ever widened to include one of
 * those, an attendee could check themselves in by typing.
 */
describe("obligation write allowlist", () => {
  const OPERATIONAL_COLUMNS = [
    "badge_print_status",
    "checked_in_at",
    "assignment_status",
    "person_kind",
    "organization_id",
    "user_id",
  ];

  it("never includes an operational column, for any combination of holdings", () => {
    const kindSets = [["registration"], ["event"], ["registration", "event"], ["booth"], []];
    for (const kinds of kindSets) {
      const keys = computePersonObligations(grantTypesForKinds(kinds), {}).obligations.map((o) => o.key);
      for (const column of OPERATIONAL_COLUMNS) {
        expect(keys, `kinds=${kinds.join("+")}`).not.toContain(column);
      }
    }
  });

  it("someone who holds nothing owes nothing, so the handler writes nothing", () => {
    expect(computePersonObligations([], {}).obligations).toEqual([]);
  });

  it("an empty answer leaves the obligation outstanding", () => {
    // The handler stores "" as NULL precisely so this stays true: a blank
    // dietary field must not read as a satisfied requirement.
    const status = computePersonObligations(["meal_access"], { dietary_restrictions: null });
    expect(status.missing.map((m) => m.key)).toContain("dietary_restrictions");
    expect(computePersonObligations(["meal_access"], { dietary_restrictions: "   " }).isReady).toBe(false);
  });
});

describe("who actually gets asked for dietary restrictions", () => {
  it("asks anyone holding a social event ticket", () => {
    // The regression this pins: `event` used to map to education_access alone,
    // which carries no obligations. dietary_restrictions was reachable only
    // through `meal` or `offsite_seat`, and CSC 2027 sells neither — so the
    // question was unanswerable by construction.
    const keys = computePersonObligations(grantTypesForKinds(["event"]), {}).obligations.map((o) => o.key);
    expect(keys).toContain("dietary_restrictions");
  });

  it("does not ask a booth-only holder", () => {
    const keys = computePersonObligations(grantTypesForKinds(["booth"]), {}).obligations.map((o) => o.key);
    expect(keys).not.toContain("dietary_restrictions");
  });

  it("still does not invent an emergency contact from a kind alone", () => {
    // Whether an event leaves the venue is per-entity, not per-kind.
    const keys = computePersonObligations(grantTypesForKinds(["event", "registration"]), {}).obligations.map((o) => o.key);
    expect(keys).not.toContain("emergency_contact_name");
  });
});
