/**
 * A rule can now point somewhere other than a Circle space.
 *
 * board@campusstores.ca asks the same question the existing kinds answer —
 * who belongs in this destination, kept in step on a schedule — against a
 * different population and a different store. Extending the rules rather than
 * building a second job with its own table, cron and panel.
 *
 * ⚠️ The thing these guard: every rule written before destinations existed is
 * a Circle rule, and must keep behaving as one without being touched.
 */
import { describe, it, expect } from "vitest";
import { parseRuleRow, ruleDestination, validateRuleInput, type SpaceRuleRow } from "../space-rules";

const row = (over: Partial<SpaceRuleRow> = {}): SpaceRuleRow => ({
  id: "r1",
  space_id: 2917627,
  label: "A rule",
  kind: "conference_passes",
  conference_id: "conf-1",
  pass_entity_ids: null,
  survey_field: null,
  survey_value: null,
  last_run: null,
  last_run_at: null,
  ...over,
});

describe("rules written before destinations existed", () => {
  it("read as Circle rules with no destination column at all", () => {
    expect(ruleDestination(row())).toEqual({ kind: "circle_space", spaceId: 2917627 });
  });

  it("read as Circle rules when the column says so", () => {
    expect(ruleDestination(row({ destination: "circle_space" }))).toEqual({
      kind: "circle_space",
      spaceId: 2917627,
    });
  });

  it("still parse to the same kinds", () => {
    const parsed = parseRuleRow(row());
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed !== "string") expect(parsed.kind).toBe("conference_passes");
  });
});

describe("a Google group destination", () => {
  it("resolves to the address, lowercased", () => {
    expect(
      ruleDestination(
        row({ destination: "google_group", space_id: null, google_group_email: "Board@CampusStores.ca" })
      )
    ).toEqual({ kind: "google_group", groupEmail: "board@campusstores.ca" });
  });

  it("is refused with no address rather than silently doing nothing", () => {
    expect(ruleDestination(row({ destination: "google_group", space_id: null }))).toBe(
      "no Google group address set"
    );
  });

  it("refuses a Circle rule with no space", () => {
    expect(ruleDestination(row({ space_id: null }))).toBe("no Circle space set");
  });
});

describe("the governance_role kind", () => {
  const governance = (over: Partial<SpaceRuleRow> = {}) =>
    row({
      kind: "governance_role",
      conference_id: null,
      space_id: null,
      destination: "google_group",
      google_group_email: "board@campusstores.ca",
      body_key: "board_of_directors",
      role_key: "director",
      ...over,
    });

  it("parses body and role", () => {
    const parsed = parseRuleRow(governance());
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed !== "string" && parsed.kind === "governance_role") {
      expect(parsed.bodyKey).toBe("board_of_directors");
      expect(parsed.roleKey).toBe("director");
      expect(parsed.spaceId).toBeNull();
    }
  });

  it("says what is missing rather than matching nobody", () => {
    // A rule with no role silently matches no one, which reads as "the job is
    // broken" rather than "the rule is incomplete".
    expect(parseRuleRow(governance({ role_key: null }))).toBe("no role set");
    expect(parseRuleRow(governance({ body_key: null }))).toBe("no governance body set");
  });
});

/**
 * What the admin form can send. The form only offers combinations that work,
 * but it is one `kind` radio away from sending one that does not, and the
 * database answers a bad combination with a CHECK violation nobody can read.
 */
describe("saving a rule from the form", () => {
  const roleInput = {
    spaceId: null,
    label: "Board mailing list",
    kind: "governance_role",
    destination: "google_group",
    googleGroupEmail: "Board@CampusStores.ca",
    bodyKey: "board_of_directors",
    roleKey: "director",
  };

  it("saves a role rule against a group, with the address lowercased", () => {
    const out = validateRuleInput(roleInput);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row).toMatchObject({
      destination: "google_group",
      google_group_email: "board@campusstores.ca",
      space_id: null,
      kind: "governance_role",
      body_key: "board_of_directors",
      role_key: "director",
      conference_id: null,
      survey_field: null,
    });
  });

  it("refuses a role rule with no body or role, which would match nobody", () => {
    expect(validateRuleInput({ ...roleInput, bodyKey: "  " })).toEqual({
      ok: false,
      error: "Pick a governance body.",
    });
    expect(validateRuleInput({ ...roleInput, roleKey: null })).toEqual({ ok: false, error: "Pick a role." });
  });

  it("refuses a group rule with no address, or an address that is not one", () => {
    expect(validateRuleInput({ ...roleInput, googleGroupEmail: "" })).toEqual({
      ok: false,
      error: "Give the Google group's address.",
    });
    expect(validateRuleInput({ ...roleInput, googleGroupEmail: "board" })).toEqual({
      ok: false,
      error: "That does not look like an email address.",
    });
  });

  it("refuses the two crossed pairings the form must never send", () => {
    // A role rule pointed at a Circle space: nothing reads it there.
    expect(validateRuleInput({ ...roleInput, destination: "circle_space", spaceId: 2917627 })).toEqual({
      ok: false,
      error: "A role rule keeps a Google group in step, not a Circle space.",
    });
    // A pass rule pointed at a group: the group sync only knows roles.
    expect(
      validateRuleInput({
        spaceId: null,
        label: "All Conference",
        kind: "conference_passes",
        destination: "google_group",
        googleGroupEmail: "board@campusstores.ca",
        conferenceId: "conf-1",
      })
    ).toEqual({ ok: false, error: "Only a role rule can keep a Google group in step." });
  });

  it("still saves a Circle rule that names no destination at all", () => {
    const out = validateRuleInput({
      spaceId: 2917627,
      label: "All Conference",
      kind: "conference_passes",
      conferenceId: "conf-1",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.row).toMatchObject({
      destination: "circle_space",
      space_id: 2917627,
      google_group_email: null,
      body_key: null,
      role_key: null,
    });
  });
});
