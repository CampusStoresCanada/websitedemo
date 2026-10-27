import { describe, expect, it } from "vitest";
import { parseRuleRow, validateRuleInput, type SpaceRuleRow } from "@/lib/circle/space-rules";

function row(over: Partial<SpaceRuleRow>): SpaceRuleRow {
  return {
    id: "r1",
    space_id: 5,
    label: "All",
    kind: "conference_passes",
    conference_id: "conf",
    pass_entity_ids: null,
    survey_field: null,
    survey_value: null,
    last_run: null,
    last_run_at: null,
    ...over,
  };
}

describe("parseRuleRow", () => {
  it("reads a conference rule, null passes meaning every pass", () => {
    expect(parseRuleRow(row({}))).toMatchObject({ kind: "conference_passes", spaceId: 5, conferenceId: "conf", passEntityIds: null });
  });

  it("reads a survey rule", () => {
    expect(
      parseRuleRow(row({ kind: "survey_answer", conference_id: null, survey_field: "pos_system", survey_value: "Bookware" }))
    ).toMatchObject({ kind: "survey_answer", field: "pos_system", value: "Bookware" });
  });

  it("refuses a survey field outside the allow-list, since the job selects it by name", () => {
    expect(
      parseRuleRow(row({ kind: "survey_answer", conference_id: null, survey_field: "organization_id", survey_value: "x" }))
    ).toBe('unknown survey field "organization_id"');
  });
});

describe("validateRuleInput", () => {
  it("needs a space, a label and a conference for a pass rule", () => {
    expect(validateRuleInput({ spaceId: 0, label: "x", kind: "conference_passes", conferenceId: "c" }).ok).toBe(false);
    expect(validateRuleInput({ spaceId: 5, label: "  ", kind: "conference_passes", conferenceId: "c" }).ok).toBe(false);
    expect(validateRuleInput({ spaceId: 5, label: "x", kind: "conference_passes" }).ok).toBe(false);
  });

  it("treats an empty pass list as a mistake, not 'every pass'", () => {
    expect(validateRuleInput({ spaceId: 5, label: "x", kind: "conference_passes", conferenceId: "c", passEntityIds: [] }).ok).toBe(false);
  });

  it("clears the other kind's fields", () => {
    const r = validateRuleInput({
      spaceId: 5,
      label: " Bookware ",
      kind: "survey_answer",
      conferenceId: "c",
      passEntityIds: ["p"],
      surveyField: "pos_system",
      surveyValue: "Bookware",
    });
    expect(r).toEqual({
      ok: true,
      row: {
        space_id: 5,
        label: "Bookware",
        kind: "survey_answer",
        conference_id: null,
        pass_entity_ids: null,
        survey_field: "pos_system",
        survey_value: "Bookware",
      },
    });
  });
});
