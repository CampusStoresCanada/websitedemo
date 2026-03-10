"use server";

import {
  requireAdmin,
  requireReviewerOrAdmin,
} from "@/lib/auth/guards";
import type { AuthContext } from "@/lib/auth/guards";
import type { Json } from "@/lib/database.types";
import type { SurveyFieldConfig } from "@/lib/benchmarking/default-field-config";
import { DEFAULT_FIELD_CONFIG } from "@/lib/benchmarking/default-field-config";
import { promoteBenchmarkingToOrganizationCurrentState } from "@/lib/benchmarking/promotion";

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
  closesAt: string | null
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
  newStatus: string
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
  closesAt: string | null
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
  benchmarkingId: string
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
    console.error("[benchmarking-admin] verifySubmission promotion error:", promotion.error);
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
  benchmarkingId: string
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
  committeeNotes: string
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
// Reviewer Management (admin-only)
// ─────────────────────────────────────────────────────────────────

export async function toggleBenchmarkingReviewer(
  userId: string,
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  const { error } = await auth.supabase
    .from("profiles")
    .update({ is_benchmarking_reviewer: enabled })
    .eq("id", userId);

  if (error) {
    console.error("[benchmarking-admin] toggleReviewer error:", error);
    return { success: false, error: "Failed to update reviewer status" };
  }

  return { success: true };
}

export async function searchUsersForReviewer(
  query: string
): Promise<{
  success: boolean;
  users?: { id: string; displayName: string; globalRole: string; isReviewer: boolean }[];
  error?: string;
}> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  if (!query || query.trim().length < 2) {
    return { success: false, error: "Search query too short" };
  }

  const searchTerm = `%${query.trim()}%`;

  // Search profiles by display_name
  const { data: profiles, error } = await auth.supabase
    .from("profiles")
    .select("id, display_name, global_role, is_benchmarking_reviewer")
    .ilike("display_name", searchTerm)
    .limit(10);

  if (error) {
    console.error("[benchmarking-admin] searchUsers error:", error);
    return { success: false, error: "Search failed" };
  }

  const users = (profiles ?? []).map((p: { id: string; display_name: string | null; global_role: string; is_benchmarking_reviewer: boolean }) => ({
    id: p.id,
    displayName: p.display_name ?? "Unknown",
    globalRole: p.global_role,
    isReviewer: p.is_benchmarking_reviewer ?? false,
  }));

  return { success: true, users };
}

// ─────────────────────────────────────────────────────────────────
// Field Config Management (admin-only)
// ─────────────────────────────────────────────────────────────────

/**
 * Save a field_config to a survey. Validates basic structure.
 */
export async function saveFieldConfig(
  surveyId: string,
  config: SurveyFieldConfig
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdminAccess();
  if (!auth.authorized || !auth.supabase)
    return { success: false, error: auth.error };

  // Basic validation: must have sections array
  if (!config || !Array.isArray(config.sections) || config.sections.length === 0) {
    return { success: false, error: "Invalid field config: must have at least one section" };
  }

  // Validate each section has required fields
  for (const section of config.sections) {
    if (!section.id || !section.title || typeof section.order !== "number") {
      return { success: false, error: `Invalid section: missing id, title, or order` };
    }
    if (!Array.isArray(section.fields)) {
      return { success: false, error: `Section "${section.title}" must have a fields array` };
    }
    for (const field of section.fields) {
      if (!field.name || !field.label || !field.type || typeof field.order !== "number") {
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
  fromSurveyId?: string
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
  surveyId: string
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
