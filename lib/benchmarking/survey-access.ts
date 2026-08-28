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
}): Promise<SurveyAccess> {
  const { surveyId, surveyStatus, organizationId, isAdmin } = input;

  if (surveyStatus === "open") return { canFile: true, reason: "open" };

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
