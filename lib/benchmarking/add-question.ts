// Deliberately NOT "server-only": everything here is pure — name validation and
// string building — and it is the part most worth testing, since the column-name
// regex is the only thing between the editor and arbitrary DDL inside the ADD
// COLUMN clause. Executing the SQL stays in the server action.
import type { FieldType, SurveyFieldConfig } from "./default-field-config";

/**
 * Adding a question mints a COLUMN. It does not go in a blob.
 *
 * `benchmarking` is one column per question and every reader depends on that:
 * computed_metrics averages columns, the comparison cuts select columns, the
 * exports and the printable worksheet name them. An answer parked in JSON would
 * be invisible to all of it — collected, and then silently absent from every
 * number the survey exists to produce.
 *
 * The database half already existed and had never been called from anywhere:
 * public.exec_sql(sql text), SECURITY DEFINER, which refuses anything that is
 * not `ALTER TABLE ... ADD COLUMN`. It was built for this.
 */

/** Postgres type per survey field type. */
const SQL_TYPE: Record<FieldType, string> = {
  currency: "numeric",
  number: "numeric",
  integer: "integer",
  percentage: "numeric",
  text: "text",
  text_long: "text",
  select: "text",
  multiselect: "text[]",
  boolean: "boolean",
};

/**
 * A column name we are willing to interpolate into DDL.
 *
 * exec_sql takes a string, so this is the only thing standing between the
 * editor and arbitrary DDL inside the ADD COLUMN clause. Deliberately stricter
 * than Postgres allows: lowercase, starts with a letter, letters/digits/
 * underscores, and short enough that the 63-character identifier limit cannot
 * silently truncate two questions into one column.
 */
export function isSafeColumnName(name: string): boolean {
  return /^[a-z][a-z0-9_]{2,54}$/.test(name);
}

export function addColumnSql(name: string, type: FieldType): string {
  if (!isSafeColumnName(name)) {
    throw new Error(`Unsafe column name: ${name}`);
  }
  return `ALTER TABLE benchmarking ADD COLUMN IF NOT EXISTS ${name} ${SQL_TYPE[type]}`;
}

/** Every field name already spoken for, across every section. */
export function existingFieldNames(config: SurveyFieldConfig): Set<string> {
  return new Set(
    (config.sections ?? []).flatMap((s) => (s.fields ?? []).map((f) => f.name)),
  );
}

export type AddQuestionProblem =
  | "bad_name"
  | "duplicate"
  | "reserved"
  | "no_section"
  | "bad_type";

/**
 * Names a question may never take: the workflow columns. Minting over one of
 * these would hand a respondent the ability to write their own submitted_at.
 * Mirrors SYSTEM_ONLY_FIELDS in lib/actions/benchmarking-survey.ts.
 */
export const RESERVED_FIELD_NAMES = new Set([
  "id",
  "organization_id",
  "fiscal_year",
  "status",
  "submitted_at",
  "amended_at",
  "respondent_user_id",
  "verified_by",
  "verified_at",
  "qa_status",
  "created_at",
  "updated_at",
  "disclosure_level",
  "disclosure_level_set_at",
  "disclosure_level_set_by",
  "terms_acknowledged_at",
  "terms_acknowledged_by",
]);

export function validateNewQuestion(input: {
  name: string;
  type: string;
  sectionId: string;
  config: SurveyFieldConfig;
}): AddQuestionProblem | null {
  if (!isSafeColumnName(input.name)) return "bad_name";
  if (RESERVED_FIELD_NAMES.has(input.name)) return "reserved";
  if (existingFieldNames(input.config).has(input.name)) return "duplicate";
  if (!(input.type in SQL_TYPE)) return "bad_type";
  if (!(input.config.sections ?? []).some((s) => s.id === input.sectionId))
    return "no_section";
  return null;
}

export const ADD_QUESTION_MESSAGE: Record<AddQuestionProblem, string> = {
  bad_name:
    "Use lowercase letters, digits and underscores, starting with a letter, 3 to 55 characters. This becomes a database column name.",
  reserved: "That name is used by the survey's own workflow columns.",
  duplicate: "A question with that name already exists in this survey.",
  bad_type: "Unknown field type.",
  no_section: "That section does not exist in this survey.",
};
