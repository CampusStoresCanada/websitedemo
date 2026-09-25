"use server";

import { requireAdmin, requireReviewerOrAdmin } from "@/lib/auth/guards";
import type { AuthContext } from "@/lib/auth/guards";
import type { Json } from "@/lib/database.types";
import type { SurveyFieldConfig } from "@/lib/benchmarking/default-field-config";
import { DEFAULT_FIELD_CONFIG } from "@/lib/benchmarking/default-field-config";
import { promoteBenchmarkingToOrganizationCurrentState } from "@/lib/benchmarking/promotion";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import type { FieldType } from "@/lib/benchmarking/default-field-config";
import {
  addColumnSql,
  validateNewQuestion,
  ADD_QUESTION_MESSAGE,
} from "@/lib/benchmarking/add-question";

// ─────────────────────────────────────────────────────────────────
// Auth Guards
// ─────────────────────────────────────────────────────────────────

interface AuthResult {
  authorized: boolean;
  userId?: string;
  error?: string;
  supabase?: AuthContext["supabase"];
}

/**
 * Admin-only access. Used for survey management, reviewer assignments.
 */
async function verifyAdminAccess(): Promise<AuthResult> {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return { authorized: false, error: auth.error };
  }
  return {
    authorized: true,
    userId: auth.ctx.userId,
    supabase: auth.ctx.supabase,
  };
}

/**
 * Reviewer access. Allows admin OR benchmarking reviewer.
 * Used for viewing submissions, reviewing flags, verifying submissions.
 */
async function verifyReviewerAccess(): Promise<AuthResult> {
  const auth = await requireReviewerOrAdmin();
  if (!auth.ok) {
    return { authorized: false, error: auth.error };
  }
  return {
    authorized: true,
    userId: auth.ctx.userId,
    supabase: auth.ctx.supabase,
  };
}

// ─────────────────────────────────────────────────────────────────
// Survey Management (admin-only)
// ─────────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["open"],
  open: ["closed"],
  closed: ["processing"],
  processing: ["complete"],
  complete: [],
};

export async function createBenchmarkingSurvey(
  fiscalYear: number,
  title: string,
  opensAt: string | null,
  closesAt: string | null,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  if (!fiscalYear || fiscalYear < 2020 || fiscalYear > 2050) {
    return { success: false, error: "Invalid fiscal year" };
  }
  if (!title || title.trim().length === 0) {
    return { success: false, error: "Title is required" };
  }

  // Check no existing survey for this fiscal year
  const { data: existing } = await auth.supabase
    .from("benchmarking_surveys")
    .select("id")
    .eq("fiscal_year", fiscalYear)
    .single();

  if (existing) {
    return {
      success: false,
      error: `A survey for FY${fiscalYear} already exists`,
    };
  }

  const { error } = await auth.supabase.from("benchmarking_surveys").insert({
    fiscal_year: fiscalYear,
    title: title.trim(),
    status: "draft",
    opens_at: opensAt || null,
    closes_at: closesAt || null,
    created_by: auth.userId,
  });

  if (error) {
    console.error("[benchmarking-admin] createSurvey error:", error);
    return { success: false, error: "Failed to create survey" };
  }

  return { success: true };
}

export async function updateSurveyStatus(
  surveyId: string,
  newStatus: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  // Get current status
  const { data: survey } = await auth.supabase
    .from("benchmarking_surveys")
    .select("status")
    .eq("id", surveyId)
    .single();

  if (!survey) {
    return { success: false, error: "Survey not found" };
  }

  const allowed = VALID_TRANSITIONS[survey.status ?? "draft"] || [];
  if (!allowed.includes(newStatus)) {
    return {
      success: false,
      error: `Cannot transition from "${survey.status}" to "${newStatus}"`,
    };
  }

  const { error } = await auth.supabase
    .from("benchmarking_surveys")
    .update({ status: newStatus })
    .eq("id", surveyId);

  if (error) {
    console.error("[benchmarking-admin] updateSurveyStatus error:", error);
    return { success: false, error: "Failed to update status" };
  }

  return { success: true };
}

export async function updateSurveyDates(
  surveyId: string,
  opensAt: string | null,
  closesAt: string | null,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const { error } = await auth.supabase
    .from("benchmarking_surveys")
    .update({ opens_at: opensAt || null, closes_at: closesAt || null })
    .eq("id", surveyId);

  if (error) {
    console.error("[benchmarking-admin] updateSurveyDates error:", error);
    return { success: false, error: "Failed to update dates" };
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Submission Verification (reviewer access)
// ─────────────────────────────────────────────────────────────────

export async function verifySubmission(
  benchmarkingId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyReviewerAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const { error } = await auth.supabase
    .from("benchmarking")
    .update({
      verified_by: auth.userId,
      verified_at: new Date().toISOString(),
    })
    .eq("id", benchmarkingId)
    .eq("status", "submitted");

  if (error) {
    console.error("[benchmarking-admin] verifySubmission error:", error);
    return { success: false, error: "Failed to verify submission" };
  }

  const promotion = await promoteBenchmarkingToOrganizationCurrentState({
    benchmarkingId,
    promotedByUserId: auth.userId!,
    note: "Auto-promoted on submission verification.",
  });

  if (!promotion.success) {
    console.error(
      "[benchmarking-admin] verifySubmission promotion error:",
      promotion.error,
    );
    await auth.supabase
      .from("benchmarking")
      .update({ verified_by: null, verified_at: null })
      .eq("id", benchmarkingId);
    return {
      success: false,
      error: `Failed to promote verified benchmarking data: ${promotion.error}`,
    };
  }

  return { success: true };
}

export async function unverifySubmission(
  benchmarkingId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyReviewerAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const { error } = await auth.supabase
    .from("benchmarking")
    .update({ verified_by: null, verified_at: null })
    .eq("id", benchmarkingId);

  if (error) {
    console.error("[benchmarking-admin] unverifySubmission error:", error);
    return { success: false, error: "Failed to unverify submission" };
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Delta Flag Review (reviewer access)
// ─────────────────────────────────────────────────────────────────

export async function reviewDeltaFlag(
  flagId: string,
  decision: "approved" | "rejected",
  committeeNotes: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyReviewerAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  if (!["approved", "rejected"].includes(decision)) {
    return { success: false, error: "Invalid decision" };
  }

  const { error } = await auth.supabase
    .from("delta_flags")
    .update({
      committee_status: decision,
      committee_notes: committeeNotes.trim() || null,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", flagId);

  if (error) {
    console.error("[benchmarking-admin] reviewDeltaFlag error:", error);
    return { success: false, error: "Failed to review flag" };
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Field Config Management (admin-only)
// ─────────────────────────────────────────────────────────────────

/**
 * Save a field_config to a survey. Validates basic structure.
 */
/**
 * Add a question to a survey — mint the column, then put it in the config.
 *
 * The editor could edit, reorder, move and hide questions but never create one,
 * which is why a wording problem needing a question SPLIT could only be fixed by
 * a developer. Everything required was already here except this:
 *
 *   storage   public.exec_sql — SECURITY DEFINER, refuses anything that is not
 *             ALTER TABLE ... ADD COLUMN. Built for this, never once called.
 *   rendering DynamicSurveySection already renders whatever the config holds.
 *   writes    ALLOWED_FIELDS came off the hardcoded FIELD_REGISTRY, so a new
 *             field was rejected as "This field cannot be edited". It now falls
 *             back to the survey's own config — see resolveFieldDef().
 *
 * Column first, config second. The other order gives you a question that
 * renders, accepts an answer and fails on save, which reads as data loss to
 * whoever is filling it in.
 */
export async function addSurveyQuestion(input: {
  surveyId: string;
  sectionId: string;
  name: string;
  label: string;
  type: FieldType;
  helpText?: string;
  required?: boolean;
  options?: string[];
}): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const { data: survey } = await auth.supabase
    .from("benchmarking_surveys")
    .select("id, status, field_config")
    .eq("id", input.surveyId)
    .single();

  if (!survey) return { success: false, error: "Survey not found" };

  // A question added mid-cycle is a question half the stores have already gone
  // past. The column is harmless; the silent inconsistency is not.
  if (survey.status !== "draft") {
    return {
      success: false,
      error:
        `This survey is ${survey.status}. Questions can only be added while it is in draft — ` +
        `adding one now leaves every store that has already filed with a blank nobody asked them.`,
    };
  }

  const config = getFieldConfig(survey);
  const problem = validateNewQuestion({
    name: input.name,
    type: input.type,
    sectionId: input.sectionId,
    config,
  });
  if (problem) return { success: false, error: ADD_QUESTION_MESSAGE[problem] };

  // 1. Mint the column. IF NOT EXISTS, so a retry after a half-failure is safe.
  const { error: ddlError } = await auth.supabase.rpc("exec_sql", {
    sql: addColumnSql(input.name, input.type),
  });
  if (ddlError) {
    console.error("[benchmarking-admin] addSurveyQuestion DDL:", ddlError);
    return { success: false, error: "Could not create the column for that question." };
  }

  // 2. Append it to the section, at the end.
  const next: SurveyFieldConfig = {
    sections: config.sections.map((sec) =>
      sec.id !== input.sectionId
        ? sec
        : {
            ...sec,
            fields: [
              ...sec.fields,
              {
                name: input.name,
                label: input.label,
                type: input.type,
                order: sec.fields.reduce((m, f) => Math.max(m, f.order), 0) + 1,
                visible: true,
                ...(input.required ? { required: true } : {}),
                ...(input.helpText ? { helpText: input.helpText } : {}),
                ...(input.options?.length ? { options: input.options } : {}),
              },
            ],
          },
    ),
  };

  const { error } = await auth.supabase
    .from("benchmarking_surveys")
    .update({ field_config: next as unknown as Json })
    .eq("id", input.surveyId);

  if (error) {
    console.error("[benchmarking-admin] addSurveyQuestion config:", error);
    // The column exists and the config does not. Say so — a retry is safe
    // (IF NOT EXISTS), and a silent failure here is the confusing one.
    return {
      success: false,
      error: "The column was created but the survey did not save. Try adding it again.",
    };
  }

  return { success: true };
}

export async function saveFieldConfig(
  surveyId: string,
  config: SurveyFieldConfig,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  // Basic validation: must have sections array
  if (
    !config ||
    !Array.isArray(config.sections) ||
    config.sections.length === 0
  ) {
    return {
      success: false,
      error: "Invalid field config: must have at least one section",
    };
  }

  // Validate each section has required fields
  for (const section of config.sections) {
    if (!section.id || !section.title || typeof section.order !== "number") {
      return {
        success: false,
        error: `Invalid section: missing id, title, or order`,
      };
    }
    if (!Array.isArray(section.fields)) {
      return {
        success: false,
        error: `Section "${section.title}" must have a fields array`,
      };
    }
    for (const field of section.fields) {
      if (
        !field.name ||
        !field.label ||
        !field.type ||
        typeof field.order !== "number"
      ) {
        return {
          success: false,
          error: `Invalid field in section "${section.title}": missing name, label, type, or order`,
        };
      }
    }
  }

  const { error } = await auth.supabase
    .from("benchmarking_surveys")
    .update({ field_config: config as unknown as Json })
    .eq("id", surveyId);

  if (error) {
    console.error("[benchmarking-admin] saveFieldConfig error:", error);
    return { success: false, error: "Failed to save field config" };
  }

  return { success: true };
}

/**
 * Initialize a survey's field_config from another survey or from DEFAULT.
 */
export async function initializeFieldConfig(
  surveyId: string,
  fromSurveyId?: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  let config: SurveyFieldConfig = DEFAULT_FIELD_CONFIG;

  if (fromSurveyId) {
    const { data: sourceSurvey } = await auth.supabase
      .from("benchmarking_surveys")
      .select("field_config")
      .eq("id", fromSurveyId)
      .single();

    if (sourceSurvey?.field_config) {
      config = sourceSurvey.field_config as unknown as SurveyFieldConfig;
    }
  }

  return saveFieldConfig(surveyId, config);
}

/**
 * Reset a survey's field_config to NULL (revert to DEFAULT).
 */
export async function resetFieldConfig(
  surveyId: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const { error } = await auth.supabase
    .from("benchmarking_surveys")
    .update({ field_config: null })
    .eq("id", surveyId);

  if (error) {
    console.error("[benchmarking-admin] resetFieldConfig error:", error);
    return { success: false, error: "Failed to reset field config" };
  }

  return { success: true };
}
