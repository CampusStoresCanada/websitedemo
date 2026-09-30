import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Who may file the survey right now.
 *
 * There are three live states, not two:
 *
 *   closed / draft  — nobody files. Reviewers still work; question review
 *                     reads the newest survey whatever its status.
 *   beta            — only stores flagged on their recipient row. Everyone
 *                     else sees exactly what they saw yesterday.
 *   open            — all 52.
 *
 * Admins can always open it to look. That is the difference between testing
 * the path and opening the doors, and without it the only way to check the
 * survey works with a real login is to let real members start filing.
 */

export type SurveyAccess =
  | { canFile: true; reason: "open" | "beta" | "admin_preview" }
  | { canFile: false; reason: "not_started" | "closed" | "not_in_beta" };

export async function resolveSurveyAccess(input: {
  surveyId: string;
  surveyStatus: string;
  organizationId: string;
  isAdmin: boolean;
  /**
   * Does this viewer hold benchmarking.beta_tester?
   *
   * An appointment, with a term, made in the admin panel exactly like question
   * review. It opens the doors early for one person and their store, and it
   * lapses on its own when the term ends rather than sitting there until
   * somebody remembers to take it away.
   */
  isBetaTester?: boolean;
}): Promise<SurveyAccess> {
  const { surveyId, surveyStatus, organizationId, isAdmin, isBetaTester } = input;

  if (surveyStatus === "open") return { canFile: true, reason: "open" };

  /*
    A beta tester files for real, before the doors open.

    ⛔ Ahead of the draft branch below, which only ever let admins in. The whole
    point of appointing a beta tester is that they use the survey the way a
    member will, in the weeks before it opens — an admin preview is not that,
    because an admin looking at their own staff org sees a different survey to
    the one a store sees.
  */
  if (isBetaTester && (surveyStatus === "draft" || surveyStatus === "beta")) {
    return { canFile: true, reason: "beta" };
  }

  if (surveyStatus === "beta") {
    const db = createAdminClient();
    const { data } = await db
      .from("benchmarking_recipients")
      .select("is_beta")
      .eq("survey_id", surveyId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (data?.is_beta === true) return { canFile: true, reason: "beta" };
    // An admin previewing during beta is still previewing, not filing for real.
    if (isAdmin) return { canFile: true, reason: "admin_preview" };
    return { canFile: false, reason: "not_in_beta" };
  }

  if (isAdmin) return { canFile: true, reason: "admin_preview" };

  return {
    canFile: false,
    reason:
      surveyStatus === "closed" || surveyStatus === "complete"
        ? "closed"
        : "not_started",
  };
}
