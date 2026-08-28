import { createAdminClient } from "@/lib/supabase/admin";

/**
 * When a year's consent stops being changeable (the consent seal rule).
 *
 * Consent is not a gate at submission. A store can change its mind about how it
 * is described for as long as the cycle is live — that is what makes a late
 * withdrawal cheap enough to permit at all. But it cannot stay changeable
 * forever, because the moment the NEXT survey opens, last year's figures appear
 * beside this year's questions as the reference value and year-over-year
 * movement gets published against them. A withdrawal after that point would
 * retroactively change comparisons other stores have already read.
 *
 * DERIVED, NEVER STAMPED. There is no `sealed_at` column and there should not
 * be one. A stored flag has to be set by something, and the thing that sets it
 * will one day not run — leaving a year that everyone believes is sealed and
 * that is in fact still editable. Asking the question of the successor survey
 * cannot drift, because the successor survey's status is the fact itself.
 *
 * The seal fires on `open`, not on `beta`. Beta is a handful of named stores
 * filing early so we can fix what breaks; nothing is published from it, and
 * sealing the previous year off the back of eight submissions would be sealing
 * on a rehearsal.
 */

/**
 * Statuses meaning a survey has reached open — including the ones after it.
 *
 * Current status only, no history table: once a survey passes `open` it never
 * goes back, so `closed` and `complete` are proof it was open once. Without
 * these, a year would UNSEAL the moment its successor closed, which is the
 * exact opposite of what sealing means.
 */
export const SEALING_STATUSES = ["open", "closed", "processing", "complete"] as const;

export interface SurveyStatusRow {
  fiscal_year: number;
  status: string;
}

export interface SealState {
  fiscalYear: number;
  sealed: boolean;
  /** The successor year whose opening sealed it. */
  sealedByFiscalYear: number | null;
}

/**
 * Is this year's consent frozen?
 *
 * Pure, so the rule can be tested without a database and read without tracing
 * a query.
 */
export function sealStateFor(
  fiscalYear: number,
  surveys: SurveyStatusRow[],
): SealState {
  const successors = surveys
    .filter(
      (s) =>
        s.fiscal_year > fiscalYear &&
        (SEALING_STATUSES as readonly string[]).includes(s.status),
    )
    // The earliest successor that opened is the one that did the sealing, even
    // if later ones have opened since.
    .sort((a, b) => a.fiscal_year - b.fiscal_year);

  return {
    fiscalYear,
    sealed: successors.length > 0,
    sealedByFiscalYear: successors[0]?.fiscal_year ?? null,
  };
}

/** What a store is told when they try to change something frozen. */
export function sealMessage(state: SealState): string | null {
  if (!state.sealed) return null;
  return `FY${state.fiscalYear} closed when the FY${state.sealedByFiscalYear} survey opened. Those figures are now published alongside this year's, so how they are described can no longer change. Your FY${state.sealedByFiscalYear} submission is where to set this.`;
}

/**
 * The same question, against the database.
 *
 * Reads with the service role because it is a rule, not a permission: a member
 * needs the true answer about their own year whether or not they can read the
 * survey table.
 */
export async function isYearSealed(fiscalYear: number): Promise<SealState> {
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_surveys")
    .select("fiscal_year, status")
    .gt("fiscal_year", fiscalYear);

  return sealStateFor(fiscalYear, (data ?? []) as SurveyStatusRow[]);
}

/**
 * The seal state for the year a submission belongs to.
 *
 * Convenience for the common case: an action holds a benchmarking row id and
 * needs to know whether it may still be changed.
 */
export async function sealStateForBenchmarking(
  benchmarkingId: string,
): Promise<SealState | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking")
    .select("fiscal_year")
    .eq("id", benchmarkingId)
    .maybeSingle();

  if (!data?.fiscal_year) return null;
  return isYearSealed(data.fiscal_year as number);
}
