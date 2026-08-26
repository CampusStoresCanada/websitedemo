import type {
  FieldConfig,
  SurveyFieldConfig,
} from "@/lib/benchmarking/default-field-config";

/**
 * The printable gathering sheet.
 *
 * A store director does not fill this survey at a keyboard — they fill it after
 * walking a P&L, a POS export and an HR headcount into one place. The worksheet
 * exists so that walk happens once, on paper, before anyone opens the form.
 *
 * It carries last year's answers deliberately. Two reasons, and the second is
 * the one that changes the data:
 *
 *   - it saves the store finding a figure it already gave us, and
 *   - it surfaces a definition change before it becomes a delta flag. A store
 *     that sees "last year you reported $2.1M here" and knows this year's
 *     figure is $4M has been told, on paper, that something needs explaining —
 *     which is far cheaper than a reviewer phoning in November to ask.
 *
 * Only ever the reader's own history. Nothing in this module takes another
 * store's figures, and the caller scopes the query to one organization.
 */

export interface WorksheetLine {
  name: string;
  label: string;
  type: FieldConfig["type"];
  helpText?: string;
  example?: string;
  exampleCredit?: string;
  suffix?: string;
  /** For select / multiselect: printed so the reader can circle or tick one. */
  options?: string[];
  required: boolean;
  group?: string;
  indent: number;
  /** "Only if you answered X to Y" — a printed sheet cannot hide a field. */
  conditionHint?: string;
  /** Formatted prior answers, index-aligned with `Worksheet.priorYears`. */
  priorValues: (string | null)[];
}

export interface WorksheetSection {
  id: string;
  title: string;
  description?: string;
  lines: WorksheetLine[];
}

export interface Worksheet {
  organizationName: string;
  fiscalYear: number;
  closesAt: string | null;
  /** Most recent first. Empty for a store that has never filed. */
  priorYears: number[];
  sections: WorksheetSection[];
  lineCount: number;
  /**
   * True when we hold no prior submission at all. Fifteen of the 52 active
   * member stores are in this position, so the sheet says so rather than
   * printing a column of dashes and looking broken.
   */
  noHistory: boolean;
}

export type PriorRow = Record<string, unknown> & { fiscal_year: number };

function formatValue(value: unknown, type: FieldConfig["type"]): string | null {
  if (value === null || value === undefined || value === "") return null;

  switch (type) {
    case "currency": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      // No cents. These are millions-scale figures and the decimals are noise
      // on a sheet someone is reading across a desk.
      return `$${Math.round(n).toLocaleString("en-CA")}`;
    }
    case "percentage": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return `${Number(n.toFixed(1))}%`;
    }
    case "number":
    case "integer": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return n.toLocaleString("en-CA");
    }
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : null;
    case "multiselect": {
      // text[] column — String() on an array gives "a,b" with no spaces.
      if (!Array.isArray(value)) return String(value).trim() || null;
      const picked = value.filter(Boolean).map(String);
      return picked.length ? picked.join(", ") : null;
    }
    default: {
      const s = String(value).trim();
      if (!s) return null;
      // A long free-text answer is not useful in a narrow print column, and
      // truncating silently would misrepresent what they said last year.
      return s.length > 80 ? `${s.slice(0, 77)}…` : s;
    }
  }
}

function conditionHint(field: FieldConfig, config: SurveyFieldConfig): string | undefined {
  if (!field.showIf) return undefined;
  const target = config.sections
    .flatMap((s) => s.fields)
    .find((f) => f.name === field.showIf!.field);
  const label = target?.label ?? field.showIf.field;
  const value = field.showIf.value;
  const shown = value === true ? "yes" : value === false ? "no" : String(value);
  return `Only if “${label}” is ${shown}`;
}

function indentLevel(field: FieldConfig): number {
  if (typeof field.indent === "number") return field.indent;
  return field.indent ? 1 : 0;
}

/**
 * Which fields earn a line on paper.
 *
 * Calculated fields are excluded: the form works them out, so printing a blank
 * box invites someone to compute a total by hand and then wonder why the screen
 * disagrees. Display-only fields are excluded for the same reason — there is
 * nothing to gather.
 */
function isGatherable(field: FieldConfig): boolean {
  if (field.visible === false) return false;
  if (field.calculated) return false;
  if (field.displayOnly) return false;
  return true;
}

export function buildWorksheet(input: {
  organizationName: string;
  fiscalYear: number;
  closesAt: string | null;
  config: SurveyFieldConfig;
  /** Every prior submission we hold for THIS organization. Any order. */
  priorRows: PriorRow[];
  /** How many prior years to print. More than three will not fit the page. */
  maxPriorYears?: number;
}): Worksheet {
  const {
    organizationName,
    fiscalYear,
    closesAt,
    config,
    priorRows,
    maxPriorYears = 2,
  } = input;

  const priors = [...priorRows]
    .filter((r) => r.fiscal_year < fiscalYear)
    .sort((a, b) => b.fiscal_year - a.fiscal_year)
    .slice(0, maxPriorYears);

  const priorYears = priors.map((r) => r.fiscal_year);

  const sections: WorksheetSection[] = [...config.sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      lines: [...section.fields]
        .filter(isGatherable)
        .sort((a, b) => a.order - b.order)
        .map((field) => ({
          name: field.name,
          label: field.label,
          type: field.type,
          helpText: field.helpText,
          example: field.example,
          exampleCredit: field.exampleCredit,
          suffix: field.suffix,
          options: field.options,
          required: field.required === true,
          group: field.group,
          indent: indentLevel(field),
          conditionHint: conditionHint(field, config),
          priorValues: priors.map((row) => formatValue(row[field.name], field.type)),
        })),
    }))
    // A section whose fields are all calculated has nothing to gather.
    .filter((s) => s.lines.length > 0);

  return {
    organizationName,
    fiscalYear,
    closesAt,
    priorYears,
    sections,
    lineCount: sections.reduce((n, s) => n + s.lines.length, 0),
    noHistory: priors.length === 0,
  };
}
