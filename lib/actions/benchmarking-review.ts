"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import type { SurveyFieldConfig } from "@/lib/benchmarking/default-field-config";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";

// ─────────────────────────────────────────────────────────────────
// Content review — store directors walking the instrument.
//
// Writes always go through createAdminClient(). The session client has SELECT
// only: a GRANT without a matching write policy returns zero rows with
// error:null, which reads as success and silently loses the reviewer's work.
// ─────────────────────────────────────────────────────────────────

type ReviewStatus = "pending" | "ok" | "ambiguous" | "needs_example";
type Resolution = "open" | "applied" | "declined" | "for_session";

interface ReviewAccess {
  ok: boolean;
  userId?: string;
  isAdmin?: boolean;
  error?: string;
}

async function verifyContentReviewer(): Promise<ReviewAccess> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };

  const { userId, globalRole } = auth.ctx;
  const admin = isGlobalAdmin(globalRole);
  if (admin) return { ok: true, userId, isAdmin: true };

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_benchmarking_content_reviewer")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.is_benchmarking_content_reviewer !== true) {
    return { ok: false, error: "Content reviewer access required" };
  }
  return { ok: true, userId, isAdmin: false };
}

async function verifyAdmin(): Promise<ReviewAccess> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };
  if (!isGlobalAdmin(auth.ctx.globalRole)) {
    return { ok: false, error: "Admin access required" };
  }
  return { ok: true, userId: auth.ctx.userId, isAdmin: true };
}

/**
 * Upsert this reviewer's verdict on one field. Partial — send only what
 * changed. Reviewers can revise until Steve resolves the row.
 */
export async function saveFieldReview(
  surveyId: string,
  fieldName: string,
  patch: {
    status?: ReviewStatus;
    comment?: string | null;
    proposedExample?: string | null;
    proposedExampleCredit?: string | null;
    proposedHelpText?: string | null;
  },
): Promise<{ success: boolean; error?: string }> {
  const access = await verifyContentReviewer();
  if (!access.ok || !access.userId) {
    return { success: false, error: access.error };
  }

  const row: {
    survey_id: string;
    field_name: string;
    reviewer_id: string;
    status?: ReviewStatus;
    comment?: string | null;
    proposed_example?: string | null;
    proposed_example_credit?: string | null;
    proposed_help_text?: string | null;
  } = {
    survey_id: surveyId,
    field_name: fieldName,
    reviewer_id: access.userId,
  };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.comment !== undefined) row.comment = patch.comment || null;
  if (patch.proposedExample !== undefined)
    row.proposed_example = patch.proposedExample || null;
  if (patch.proposedExampleCredit !== undefined)
    row.proposed_example_credit = patch.proposedExampleCredit || null;
  if (patch.proposedHelpText !== undefined)
    row.proposed_help_text = patch.proposedHelpText || null;

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_field_reviews")
    .upsert(row, { onConflict: "survey_id,field_name,reviewer_id" });

  if (error) {
    console.error("[benchmarking-review] saveFieldReview error:", error);
    return { success: false, error: "Could not save your review" };
  }

  revalidatePath("/benchmarking/review");
  return { success: true };
}

/**
 * Steve's disposition on one reviewer's row. "for_session" parks it for the
 * live call rather than settling it async — that list becomes the agenda.
 */
export async function resolveFieldReview(
  reviewId: string,
  resolution: Resolution,
  note?: string,
): Promise<{ success: boolean; error?: string }> {
  const access = await verifyAdmin();
  if (!access.ok || !access.userId) {
    return { success: false, error: access.error };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_field_reviews")
    .update({
      resolution,
      resolution_note: note ?? null,
      resolved_by: access.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reviewId);

  if (error) {
    console.error("[benchmarking-review] resolveFieldReview error:", error);
    return { success: false, error: "Could not resolve" };
  }

  revalidatePath("/benchmarking/admin/review");
  return { success: true };
}

/**
 * Take a reviewer's proposed example (and help text, if they rewrote it) and
 * write it into the survey's live field_config, then mark the row applied.
 *
 * This is the payoff: what a director wrote in September is what all 52 stores
 * read in October.
 */
export async function applyFieldReview(
  reviewId: string,
): Promise<{ success: boolean; error?: string }> {
  const access = await verifyAdmin();
  if (!access.ok || !access.userId) {
    return { success: false, error: access.error };
  }

  const db = createAdminClient();

  const { data: review, error: readErr } = await db
    .from("benchmarking_field_reviews")
    .select(
      "id, survey_id, field_name, proposed_example, proposed_example_credit, proposed_help_text",
    )
    .eq("id", reviewId)
    .maybeSingle();

  if (readErr || !review) {
    return { success: false, error: "Review not found" };
  }
  if (!review.proposed_example && !review.proposed_help_text) {
    return { success: false, error: "Nothing proposed to apply" };
  }

  const { data: survey, error: surveyErr } = await db
    .from("benchmarking_surveys")
    .select("id, field_config")
    .eq("id", review.survey_id)
    .maybeSingle();

  if (surveyErr || !survey) {
    return { success: false, error: "Survey not found" };
  }

  const config = getFieldConfig(
    survey as { field_config: unknown },
  ) as SurveyFieldConfig;

  let touched = false;
  const next: SurveyFieldConfig = {
    ...config,
    sections: config.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (field.name !== review.field_name) return field;
        touched = true;
        return {
          ...field,
          ...(review.proposed_example
            ? {
                example: review.proposed_example,
                exampleCredit: review.proposed_example_credit ?? undefined,
              }
            : {}),
          ...(review.proposed_help_text
            ? { helpText: review.proposed_help_text }
            : {}),
        };
      }),
    })),
  };

  if (!touched) {
    return {
      success: false,
      error: `Field ${review.field_name} is no longer in this survey`,
    };
  }

  const { error: writeErr } = await db
    .from("benchmarking_surveys")
    .update({ field_config: next as unknown as never })
    .eq("id", survey.id);

  if (writeErr) {
    console.error(
      "[benchmarking-review] applyFieldReview write error:",
      writeErr,
    );
    return { success: false, error: "Could not write the field config" };
  }

  await db
    .from("benchmarking_field_reviews")
    .update({
      resolution: "applied",
      resolved_by: access.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reviewId);

  revalidatePath("/benchmarking/admin/review");
  revalidatePath("/benchmarking/survey");
  return { success: true };
}
