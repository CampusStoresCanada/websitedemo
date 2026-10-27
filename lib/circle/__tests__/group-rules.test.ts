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
import { parseRuleRow, ruleDestination, type SpaceRuleRow } from "../space-rules";

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
