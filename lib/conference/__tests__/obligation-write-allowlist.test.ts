import { describe, expect, it } from "vitest";
import { computePersonObligations, isPersonalObligation } from "../access";
import {
  SELF_EDITABLE_PERSON_FIELDS,
  isIdentityProjectionField,
  isSelfEditablePersonField,
} from "../person-fields";
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
describe("identity fields never reach the conference projection", () => {
  it("refuses badge name, contact email and title on conference_people", () => {
    // conference_people is a projection; contacts is the canonical record.
    // Writing a name here forks it into a second place that never syncs back,
    // which is why updateConferencePersonSelf rejects these outright and the
    // contact modal edits the contact instead.
    for (const key of ["display_name", "contact_email", "role_title"]) {
      expect(isIdentityProjectionField(key)).toBe(true);
      expect(isSelfEditablePersonField(key)).toBe(false);
    }
  });

  it("keeps the two policies disjoint", () => {
    const overlap = SELF_EDITABLE_PERSON_FIELDS.filter(isIdentityProjectionField);
    expect(overlap).toEqual([]);
  });
});

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

describe("who may answer which obligation", () => {
  it("marks the facts about a person as theirs alone", () => {
    expect(isPersonalObligation("dietary_restrictions")).toBe(true);
    expect(isPersonalObligation("accessibility_needs")).toBe(true);
    expect(isPersonalObligation("emergency_contact_name")).toBe(true);
    expect(isPersonalObligation("emergency_contact_phone")).toBe(true);
  });

  it("leaves the badge to the organisation that bought the seat", () => {
    expect(isPersonalObligation("display_name")).toBe(false);
    expect(isPersonalObligation("contact_email")).toBe(false);
  });

  it("covers every obligation a social-ticket holder owes", () => {
    // If a new personal-sounding obligation is added to a grant type and not
    // to SELF_EDITABLE_PERSON_FIELDS, the UI would offer it to an org admin
    // while the server refused the write. This is the test that notices.
    const keys = computePersonObligations(
      grantTypesForKinds(["registration", "event"]), {}
    ).obligations.map((o) => o.key);
    const unclassified = keys.filter(
      (k) => !isPersonalObligation(k) && !["display_name", "contact_email"].includes(k)
    );
    expect(unclassified).toEqual([]);
  });
});
