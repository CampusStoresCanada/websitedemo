// ---------------------------------------------------------------------------
// Circle space rules: which private Circle spaces are kept in step with whom.
//
// One row per space in `circle_space_rules`, edited at /admin/circle/spaces and
// applied hourly by lib/circle/conference-access.ts. Two kinds:
//
//   conference_passes  holders of a pass at a conference (null passes = every
//                      registration-kind pass)
//   survey_answer      everyone at a current-member school whose latest
//                      submitted benchmarking answer includes a value
// ---------------------------------------------------------------------------

import type { Json } from "@/lib/database.types";

/**
 * Benchmarking array columns a survey rule may read. The job selects the column
 * by name, so the name must come from this list, never from the row as-is.
 */
export const SURVEY_ARRAY_FIELDS = [
  { field: "pos_system", label: "POS system" },
  { field: "ebook_delivery_system", label: "eBook delivery system" },
  { field: "lms_system", label: "LMS" },
  { field: "student_info_system", label: "Student information system" },
  { field: "payment_options", label: "Payment options" },
  { field: "services_offered", label: "Services offered" },
  { field: "shopping_services", label: "Shopping services" },
  { field: "store_in_stores", label: "Store-in-stores" },
  { field: "social_media_platforms", label: "Social media platforms" },
  { field: "contributions_to_campus", label: "Contributions to campus" },
  { field: "physical_inventory_schedule", label: "Physical inventory schedule" },
] as const;

export type SurveyField = (typeof SURVEY_ARRAY_FIELDS)[number]["field"];

export function isSurveyField(v: unknown): v is SurveyField {
  return SURVEY_ARRAY_FIELDS.some((f) => f.field === v);
}

/** What the job saw on its last pass over a rule. */
export type RuleLastRun = {
  holders?: number;
  noCircleAccount?: number;
  inSpace?: number;
  queuedAdds?: number;
  /** Refused by Circle in the last day (usually an unaccepted invite). */
  waitingOnInvite?: number;
  queuedRemoves?: number;
  /** Set when the rule could not be applied; the numbers are then absent. */
  error?: string;
};

type RuleBase = {
  id: string;
  spaceId: number;
  label: string;
  lastRun: RuleLastRun | null;
  lastRunAt: string | null;
};

export type ConferencePassRule = RuleBase & {
  kind: "conference_passes";
  conferenceId: string;
  /** Null = every registration-kind pass. */
  passEntityIds: string[] | null;
};

export type SurveyAnswerRule = RuleBase & {
  kind: "survey_answer";
  field: SurveyField;
  value: string;
};

export type SpaceRule = ConferencePassRule | SurveyAnswerRule;

export type SpaceRuleRow = {
  id: string;
  space_id: number;
  label: string;
  kind: string;
  conference_id: string | null;
  pass_entity_ids: string[] | null;
  survey_field: string | null;
  survey_value: string | null;
  last_run: Json | null;
  last_run_at: string | null;
};

export const SPACE_RULE_COLUMNS =
  "id, space_id, label, kind, conference_id, pass_entity_ids, survey_field, survey_value, last_run, last_run_at";

/** A row the job can act on, or the reason it cannot. */
export function parseRuleRow(row: SpaceRuleRow): SpaceRule | string {
  const base: RuleBase = {
    id: row.id,
    spaceId: Number(row.space_id),
    label: row.label,
    lastRun: row.last_run && typeof row.last_run === "object" ? (row.last_run as RuleLastRun) : null,
    lastRunAt: row.last_run_at,
  };
  if (row.kind === "conference_passes") {
    if (!row.conference_id) return "no conference set";
    return { ...base, kind: "conference_passes", conferenceId: row.conference_id, passEntityIds: row.pass_entity_ids };
  }
  if (row.kind === "survey_answer") {
    if (!isSurveyField(row.survey_field)) return `unknown survey field "${row.survey_field}"`;
    if (!row.survey_value) return "no survey answer set";
    return { ...base, kind: "survey_answer", field: row.survey_field, value: row.survey_value };
  }
  return `unknown rule kind "${row.kind}"`;
}

/** Input from the admin form, checked before it is written. */
export type SpaceRuleInput = {
  spaceId: number;
  label: string;
  kind: string;
  conferenceId?: string | null;
  passEntityIds?: string[] | null;
  surveyField?: string | null;
  surveyValue?: string | null;
};

export function validateRuleInput(
  input: SpaceRuleInput
): { ok: true; row: Omit<SpaceRuleRow, "id" | "last_run" | "last_run_at"> } | { ok: false; error: string } {
  if (!Number.isInteger(input.spaceId) || input.spaceId <= 0) return { ok: false, error: "Pick a Circle space." };
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Give the rule a label." };
  if (input.kind === "conference_passes") {
    if (!input.conferenceId) return { ok: false, error: "Pick a conference." };
    const passes = input.passEntityIds ?? null;
    if (passes && passes.length === 0) return { ok: false, error: "Pick at least one pass, or choose every pass." };
    return {
      ok: true,
      row: {
        space_id: input.spaceId,
        label,
        kind: "conference_passes",
        conference_id: input.conferenceId,
        pass_entity_ids: passes,
        survey_field: null,
        survey_value: null,
      },
    };
  }
  if (input.kind === "survey_answer") {
    if (!isSurveyField(input.surveyField)) return { ok: false, error: "Pick a survey question." };
    const value = input.surveyValue?.trim();
    if (!value) return { ok: false, error: "Pick an answer." };
    return {
      ok: true,
      row: {
        space_id: input.spaceId,
        label,
        kind: "survey_answer",
        conference_id: null,
        pass_entity_ids: null,
        survey_field: input.surveyField,
        survey_value: value,
      },
    };
  }
  return { ok: false, error: "Pick what qualifies someone for the space." };
}
