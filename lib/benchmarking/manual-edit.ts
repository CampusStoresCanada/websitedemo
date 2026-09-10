import { createAdminClient } from "@/lib/supabase/admin";
import { isYearClosedToWrites } from "./metrics";

/**
 * Editing benchmarking figures from the org page, outside the survey.
 *
 * The survey is the instrument of record. While a cycle is live, a correction
 * belongs in the survey form, where it is a submission — validated field by
 * field against FIELD_REGISTRY, delta-flagged against last year, and seen by
 * the committee. The Toolkit deliberately stands down for the six weeks that
 * matters and sends the store there instead.
 *
 * The rest of the year there was no path at all. A store that spotted a wrong
 * figure in February could do nothing about it until October, which is most of
 * the reason the figures drift. This opens that path, on one condition: an edit
 * made outside the survey is marked as one. It never silently becomes
 * indistinguishable from what the store filed.
 *
 * WHAT MARKS IT. Three things, none of them new storage:
 *   - benchmarking.amended_at — the row was touched after filing
 *   - audit_log — which field, from what, to what, by whom, when
 *   - the survey status at the time, recorded in the audit details, so a later
 *     reader can tell a between-cycles correction from an in-cycle one without
 *     having to reconstruct the calendar of that year
 *
 * The audit rows are the history; amended_at is the cheap flag that says one
 * exists. Nothing here invents a fourth place to keep the truth.
 */

/** Survey states during which the Toolkit defers to the survey form. */
const SURVEY_IS_LIVE = ["open", "beta"] as const;

export interface BenchmarkingEditContext {
  id: string;
  organization_id: string;
  fiscal_year: number;
}

export type BenchmarkingEditDecision =
  | {
      allowed: true;
      /** True whenever the write happens outside a live survey — which, given
       *  the rule above, is every write this path ever performs. Kept explicit
       *  rather than assumed so the audit row states it rather than implying it. */
      manualAmendment: boolean;
      surveyStatus: string | null;
      /** The year's published metrics are frozen; the source row still changes.
       *  See CLOSED_TO_WRITES in ./metrics. */
      metricsFrozen: boolean;
    }
  | { allowed: false; reason: string };

/**
 * May this benchmarking row be corrected from the org page right now?
 *
 * Pure decision, given the two facts it needs, so the rule can be read and
 * tested without a database.
 */
export function decideBenchmarkingEdit(input: {
  /** Is this the newest year on file for the org? */
  isLatestYear: boolean;
  fiscalYear: number;
  surveyStatus: string | null;
}): BenchmarkingEditDecision {
  // Older years are the record other people's reports were built from. A store
  // that needs one changed is asking for a restatement, which is a conversation
  // with CSC and not a click.
  if (!input.isLatestYear) {
    return {
      allowed: false,
      reason:
        `FY${input.fiscalYear} is not your most recent year on file. Earlier years ` +
        `stay as filed — contact CSC if one needs correcting.`,
    };
  }

  if (
    input.surveyStatus &&
    (SURVEY_IS_LIVE as readonly string[]).includes(input.surveyStatus)
  ) {
    return {
      allowed: false,
      reason:
        `The FY${input.fiscalYear} survey is open, so this belongs in the survey ` +
        `itself — that way it counts as your submission rather than a correction ` +
        `to one. Open it from Benchmarking.`,
    };
  }

  return {
    allowed: true,
    manualAmendment: true,
    surveyStatus: input.surveyStatus,
    metricsFrozen: isYearClosedToWrites(input.surveyStatus),
  };
}

/**
 * Fetch the two facts and apply the rule.
 *
 * Service role: the caller (update-field) has already established that this
 * user administers the org. This only reads the survey calendar and the org's
 * own year list, neither of which is a permission decision.
 */
export async function resolveBenchmarkingEdit(
  row: BenchmarkingEditContext,
): Promise<BenchmarkingEditDecision> {
  const db = createAdminClient();

  const { data: newest } = await db
    .from("benchmarking")
    .select("fiscal_year")
    .eq("organization_id", row.organization_id)
    .order("fiscal_year", { ascending: false })
    .limit(1)
    .maybeSingle();

  // No newest row is impossible (we are holding one), but treat an unreadable
  // answer as "not latest" rather than waving the edit through.
  const isLatestYear = newest?.fiscal_year === row.fiscal_year;

  const { data: survey } = await db
    .from("benchmarking_surveys")
    .select("status")
    .eq("fiscal_year", row.fiscal_year)
    .maybeSingle();

  return decideBenchmarkingEdit({
    isLatestYear,
    fiscalYear: row.fiscal_year,
    surveyStatus: (survey?.status as string | null) ?? null,
  });
}

/**
 * Has this year's package already gone out to members?
 *
 * Same rule syncMetricsFor applies, asked from the read side so the org page
 * can say what will happen before someone edits rather than after. A store
 * correcting a published year should know the comparison charts will keep the
 * published figure until CSC restates the year.
 */
export async function surveyYearIsPublished(fiscalYear: number): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("benchmarking_surveys")
    .select("status")
    .eq("fiscal_year", fiscalYear)
    .maybeSingle();

  return isYearClosedToWrites(data?.status as string | null);
}

export interface ManualEditMark {
  column: string;
  previousValue: string | number | null;
  newValue: string | number | null;
  changedAt: string;
  changedByEmail: string | null;
}

/**
 * Which fields on this row were corrected outside the survey, and when.
 *
 * Read back out of audit_log rather than denormalised onto the row. The audit
 * rows already carry every fact the marker needs, and a second copy on
 * `benchmarking` would be one more thing to keep in step — and the first thing
 * to go stale.
 *
 * Newest write per column wins: the marker answers "was this figure changed
 * after filing", and the full sequence is in the audit trail for anyone who
 * needs it.
 */
export async function getManualEditMarks(
  benchmarkingId: string,
): Promise<Record<string, ManualEditMark>> {
  const db = createAdminClient();

  const { data, error } = await db
    .from("audit_log")
    .select("details, created_at")
    .eq("entity_type", "benchmarking")
    .eq("entity_id", benchmarkingId)
    .eq("action", "field.update")
    .order("created_at", { ascending: false });

  if (error) {
    // A missing marker must never take the figures down with it — the page's
    // job is the numbers, and the marker is commentary on them.
    console.warn("[getManualEditMarks] read failed:", error.message);
    return {};
  }

  const marks: Record<string, ManualEditMark> = {};

  for (const entry of data ?? []) {
    const details = (entry.details ?? {}) as Record<string, unknown>;
    const column = typeof details.column === "string" ? details.column : null;
    if (!column) continue;
    // Rows written before this flag existed are still manual org-page edits —
    // update-field is the only writer that produces them — so absence is not
    // treated as "in-cycle".
    if (details.manual_amendment === false) continue;
    if (marks[column]) continue; // already have the newest for this column

    marks[column] = {
      column,
      previousValue: (details.previous_value ?? null) as string | number | null,
      newValue: (details.new_value ?? null) as string | number | null,
      changedAt: entry.created_at,
      changedByEmail:
        typeof details.changed_by_email === "string"
          ? details.changed_by_email
          : null,
    };
  }

  return marks;
}
