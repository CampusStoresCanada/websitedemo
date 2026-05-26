"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import { ORG_ADMIN_STEPS, type OrgAdminStepKey } from "@/lib/onboarding/steps";

// Re-export so existing importers keep working.
export type { OrgAdminStepKey } from "@/lib/onboarding/steps";

// Steps that count toward "onboarding complete" (non-conditional ones)
const CORE_STEPS: OrgAdminStepKey[] = [
  "session_1_welcome",
  "public_contact_email",
  "toolkit_tour",
  "profile_description",
  "profile_logo",
  "profile_hero",
  "contacts_sorted",
  "contact_photos",
  "visibility_intro",
  "network_members",
  "network_partners",
  "network_member_space",
  "events_discovery",
];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OnboardingStep {
  step_key: string;
  persona: string;
  journey_started_at: string;
  sent_at: string | null;
  channel: string | null;
  completed_at: string | null;
  skipped_at: string | null;
  skip_reason: string | null;
  reminder_count: number;
  last_reminder_sent_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Init — idempotent, safe to call multiple times
// Creates all step rows for the org_admin journey if they don't already exist.
// ─────────────────────────────────────────────────────────────────────────────

export async function initOrgAdminJourney(): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // Only org admins (or global admins managing on behalf) get this journey
  const isOrgAdmin = auth.ctx.orgAdminOrgIds.length > 0;
  const isGlobalAdmin =
    auth.ctx.globalRole === "super_admin" || auth.ctx.globalRole === "admin";

  if (!isOrgAdmin && !isGlobalAdmin) {
    return { success: false, error: "Not an org admin" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any; // user_onboarding_progress not yet in generated types
  const now = new Date().toISOString();

  const rows = ORG_ADMIN_STEPS.map((key) => ({
    user_id: auth.ctx.userId,
    persona: "org_admin" as const,
    step_key: key,
    journey_started_at: now,
  }));

  const { error } = await db
    .from("user_onboarding_progress")
    .upsert(rows, { onConflict: "user_id,step_key", ignoreDuplicates: true });

  if (error) {
    console.error("[onboarding] initOrgAdminJourney failed:", error);
    return { success: false, error: "Failed to initialize journey" };
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Check a single step for the current user
// ─────────────────────────────────────────────────────────────────────────────

export async function getOnboardingStep(stepKey: OrgAdminStepKey): Promise<{
  success: boolean;
  step?: OnboardingStep | null;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any; // user_onboarding_progress not yet in generated types

  const { data, error } = await db
    .from("user_onboarding_progress")
    .select("*")
    .eq("user_id", auth.ctx.userId)
    .eq("step_key", stepKey)
    .maybeSingle();

  if (error) {
    console.error("[onboarding] getOnboardingStep failed:", error);
    return { success: false, error: "Failed to fetch step" };
  }

  return { success: true, step: data as OnboardingStep | null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mark a step completed (by user action)
// ─────────────────────────────────────────────────────────────────────────────

export async function completeOnboardingStep(stepKey: OrgAdminStepKey): Promise<{
  success: boolean;
  coreStepsComplete?: boolean;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any; // user_onboarding_progress not yet in generated types
  const now = new Date().toISOString();

  // Upsert so it works even if the row wasn't pre-created by initOrgAdminJourney
  const { error } = await db.from("user_onboarding_progress").upsert(
    {
      user_id: auth.ctx.userId,
      persona: "org_admin",
      step_key: stepKey,
      completed_at: now,
      journey_started_at: now, // will be ignored if row already exists via ignoreDuplicates=false
      updated_at: now,
    },
    { onConflict: "user_id,step_key" }
  );

  if (error) {
    console.error("[onboarding] completeOnboardingStep failed:", error);
    return { success: false, error: "Failed to mark step complete" };
  }

  // Check if all core steps are now done — if so, mark users.onboarding_completed
  const { data: completedRows } = await db
    .from("user_onboarding_progress")
    .select("step_key")
    .eq("user_id", auth.ctx.userId)
    .eq("persona", "org_admin")
    .not("completed_at", "is", null);

  const completedKeys = new Set(
    ((completedRows ?? []) as { step_key: string }[]).map((r) => r.step_key)
  );
  const coreStepsComplete = CORE_STEPS.every((k) => completedKeys.has(k));

  if (coreStepsComplete) {
    // Best-effort — non-blocking. Cast to any since users table is typed via admin client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (createAdminClient() as any)
      .from("users")
      .update({ onboarding_completed: true, updated_at: now })
      .eq("id", auth.ctx.userId)
      .then(({ error: e }: { error: unknown }) => {
        if (e) console.warn("[onboarding] failed to set onboarding_completed:", e);
      });
  }

  return { success: true, coreStepsComplete };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset — dev + super_admin only
// Wipes all progress rows and clears the onboarding_completed flag so the
// full journey runs again from scratch. The Toolkit callout localStorage key
// must be cleared client-side (see DevPanel).
// ─────────────────────────────────────────────────────────────────────────────

export async function resetMyOnboarding(): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // Gate to dev environment OR super_admins (useful for resetting in staging/prod too)
  const isDev = process.env.NODE_ENV === "development";
  const isSuperAdmin = auth.ctx.globalRole === "super_admin";
  if (!isDev && !isSuperAdmin) {
    return { success: false, error: "Reset only available in dev or for super admins" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const now = new Date().toISOString();

  const { error: deleteError } = await db
    .from("user_onboarding_progress")
    .delete()
    .eq("user_id", auth.ctx.userId)
    .eq("persona", "org_admin");

  if (deleteError) {
    console.error("[onboarding] resetMyOnboarding delete failed:", deleteError);
    return { success: false, error: "Failed to clear progress rows" };
  }

  // Reset the completed flag on the users table
  await (createAdminClient() as any)
    .from("users")
    .update({ onboarding_completed: false, updated_at: now })
    .eq("id", auth.ctx.userId);

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get all steps for current user (for the progress widget — built later)
// ─────────────────────────────────────────────────────────────────────────────

export async function getMyOnboardingProgress(): Promise<{
  success: boolean;
  steps?: OnboardingStep[];
  coreStepsComplete?: boolean;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any; // user_onboarding_progress not yet in generated types

  const { data, error } = await db
    .from("user_onboarding_progress")
    .select("*")
    .eq("user_id", auth.ctx.userId)
    .eq("persona", "org_admin")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[onboarding] getMyOnboardingProgress failed:", error);
    return { success: false, error: "Failed to fetch progress" };
  }

  const steps = (data ?? []) as OnboardingStep[];
  const completedKeys = new Set(
    steps.filter((s) => s.completed_at).map((s) => s.step_key)
  );
  const coreStepsComplete = CORE_STEPS.every((k) => completedKeys.has(k));

  return { success: true, steps, coreStepsComplete };
}
