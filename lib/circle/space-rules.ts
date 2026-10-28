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
  /** Null on a rule whose destination is not a Circle space. */
  spaceId: number | null;
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

/**
 * Everyone holding a role on a governance body — the board, a committee.
 *
 * Added for board@campusstores.ca, which is the same question the other kinds
 * answer ("who belongs in this destination") against a different population
 * and a different store. A rule rather than a bespoke job so it reconciles on
 * the same hourly tick, reports the same telemetry, and self-corrects for a
 * mid-term appointment instead of only at an election.
 */
export type GovernanceRoleRule = RuleBase & {
  kind: "governance_role";
  bodyKey: string;
  roleKey: string;
};

export type SpaceRule = ConferencePassRule | SurveyAnswerRule | GovernanceRoleRule;

/** Which store a rule keeps in step. */
export type RuleDestination =
  | { kind: "circle_space"; spaceId: number }
  | { kind: "google_group"; groupEmail: string };

export type SpaceRuleRow = {
  id: string;
  space_id: number | null;
  destination?: string | null;
  google_group_email?: string | null;
  body_key?: string | null;
  role_key?: string | null;
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
  "id, space_id, destination, google_group_email, body_key, role_key, label, kind, conference_id, pass_entity_ids, survey_field, survey_value, last_run, last_run_at";

/**
 * Where a rule points. Defaults to a Circle space, because every rule written
 * before destinations existed is one and the column defaults the same way.
 */
export function ruleDestination(row: SpaceRuleRow): RuleDestination | string {
  if ((row.destination ?? "circle_space") === "google_group") {
    if (!row.google_group_email) return "no Google group address set";
    return { kind: "google_group", groupEmail: row.google_group_email.toLowerCase() };
  }
  if (row.space_id === null) return "no Circle space set";
  return { kind: "circle_space", spaceId: Number(row.space_id) };
}

/** A row the job can act on, or the reason it cannot. */
export function parseRuleRow(row: SpaceRuleRow): SpaceRule | string {
  const base: RuleBase = {
    id: row.id,
    spaceId: row.space_id === null ? null : Number(row.space_id),
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
  if (row.kind === "governance_role") {
    if (!row.body_key) return "no governance body set";
    if (!row.role_key) return "no role set";
    return { ...base, kind: "governance_role", bodyKey: row.body_key, roleKey: row.role_key };
  }
  return `unknown rule kind "${row.kind}"`;
}

/** Input from the admin form, checked before it is written. */
export type SpaceRuleInput = {
  /** Required for a circle_space rule; ignored for a google_group one. */
  spaceId: number | null;
  label: string;
  kind: string;
  destination?: string | null;
  googleGroupEmail?: string | null;
  bodyKey?: string | null;
  roleKey?: string | null;
  conferenceId?: string | null;
  passEntityIds?: string[] | null;
  surveyField?: string | null;
  surveyValue?: string | null;
};

export function validateRuleInput(
  input: SpaceRuleInput
):
  | {
      ok: true;
      /**
       * ⚠️ `destination` is non-null here even though the read row has it
       * optional: the column is NOT NULL, so a write must always name one.
       * Deriving this shape straight from the read row had it offering
       * `destination: null` to that column.
       */
      row: Omit<SpaceRuleRow, "id" | "last_run" | "last_run_at" | "destination"> & {
        destination: string;
      };
    }
  | { ok: false; error: string } {
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Give the rule a label." };

  const destination = input.destination === "google_group" ? "google_group" : "circle_space";

  // The destination decides which target is required, and the database says the
  // same thing in a CHECK — this is the message a person reads instead of it.
  if (destination === "circle_space") {
    if (!Number.isInteger(input.spaceId) || (input.spaceId ?? 0) <= 0)
      return { ok: false, error: "Pick a Circle space." };
  }

  const groupEmail = input.googleGroupEmail?.trim().toLowerCase() || null;
  if (destination === "google_group") {
    if (!groupEmail) return { ok: false, error: "Give the Google group's address." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(groupEmail))
      return { ok: false, error: "That does not look like an email address." };
  }

  const target = {
    destination,
    space_id: destination === "circle_space" ? input.spaceId : null,
    google_group_email: destination === "google_group" ? groupEmail : null,
  };

  if (input.kind === "governance_role") {
    if (destination !== "google_group")
      return { ok: false, error: "A role rule keeps a Google group in step, not a Circle space." };
    const bodyKey = input.bodyKey?.trim();
    const roleKey = input.roleKey?.trim();
    // Refused rather than saved empty: a rule with no role matches nobody, and
    // reads as a broken job rather than an unfinished rule.
    if (!bodyKey) return { ok: false, error: "Pick a governance body." };
    if (!roleKey) return { ok: false, error: "Pick a role." };
    return {
      ok: true,
      row: {
        ...target,
        label,
        kind: "governance_role",
        body_key: bodyKey,
        role_key: roleKey,
        conference_id: null,
        pass_entity_ids: null,
        survey_field: null,
        survey_value: null,
      },
    };
  }

  if (destination === "google_group")
    return { ok: false, error: "Only a role rule can keep a Google group in step." };

  if (input.kind === "conference_passes") {
    if (!input.conferenceId) return { ok: false, error: "Pick a conference." };
    const passes = input.passEntityIds ?? null;
    if (passes && passes.length === 0) return { ok: false, error: "Pick at least one pass, or choose every pass." };
    return {
      ok: true,
      row: {
        ...target,
        body_key: null,
        role_key: null,
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
        ...target,
        body_key: null,
        role_key: null,
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
