"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import {
  type Persona,
  type AnyStepKey,
  STEPS_BY_PERSONA,
  CORE_STEPS_BY_PERSONA,
} from "@/lib/onboarding/steps";

// Re-exports for backward compat
export type { OrgAdminStepKey, AnyStepKey } from "@/lib/onboarding/steps";

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
// Derive the user's persona from their org memberships
// ─────────────────────────────────────────────────────────────────────────────

export async function derivePersona(): Promise<Persona | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const db = createAdminClient();

  // Fetch the user's active org memberships with org types
  const { data: memberships } = await db
    .from("user_organizations")
    .select("role, organizations(type)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgs = (memberships ?? []) as Array<{ role: string; organizations: { type: string } | null }>;

  const isMemberOrgAdmin = orgs.some(
    (o) => o.role === "org_admin" && o.organizations?.type === "Member"
  );
  const isPartnerOrgAdmin = orgs.some(
    (o) => o.role === "org_admin" && o.organizations?.type === "Vendor Partner"
  );
  const isMemberUser = orgs.some((o) => o.organizations?.type === "Member");
  const isPartnerUser = orgs.some((o) => o.organizations?.type === "Vendor Partner");

  // Precedence: org admin roles first, then member roles
  if (isMemberOrgAdmin) return "org_admin_member";
  if (isPartnerOrgAdmin) return "org_admin_partner";
  if (isMemberUser) return "member_member";
  if (isPartnerUser) return "member_partner";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Init — idempotent, creates all step rows for the user's persona journey
// ─────────────────────────────────────────────────────────────────────────────

export async function initJourney(): Promise<{ success: boolean; persona?: Persona; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const persona = await derivePersona();
  if (!persona) return { success: false, error: "No qualifying org membership" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const now = new Date().toISOString();
  const steps = STEPS_BY_PERSONA[persona];

  const rows = steps.map((key) => ({
    user_id: auth.ctx.userId,
    persona,
    step_key: key,
    journey_started_at: now,
  }));

  const { error } = await db
    .from("user_onboarding_progress")
    .upsert(rows, { onConflict: "user_id,persona,step_key", ignoreDuplicates: true });

  if (error) {
    console.error("[onboarding] initJourney failed:", error);
    return { success: false, error: "Failed to initialize journey" };
  }

  return { success: true, persona };
}

/** @deprecated Use initJourney() — kept for backward compat */
export async function initOrgAdminJourney() {
  return initJourney();
}

// ─────────────────────────────────────────────────────────────────────────────
// Check a single step for the current user + their persona
// ─────────────────────────────────────────────────────────────────────────────

export async function getOnboardingStep(
  stepKey: AnyStepKey,
  personaOverride?: Persona
): Promise<{ success: boolean; step?: OnboardingStep | null; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const persona = personaOverride ?? await derivePersona();
  if (!persona) return { success: true, step: null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const { data, error } = await db
    .from("user_onboarding_progress")
    .select("*")
    .eq("user_id", auth.ctx.userId)
    .eq("persona", persona)
    .eq("step_key", stepKey)
    .maybeSingle();

  if (error) {
    console.error("[onboarding] getOnboardingStep failed:", error);
    return { success: false, error: "Failed to fetch step" };
  }

  return { success: true, step: data as OnboardingStep | null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mark a step completed
// ─────────────────────────────────────────────────────────────────────────────

export async function completeOnboardingStep(
  stepKey: AnyStepKey,
  personaOverride?: Persona
): Promise<{ success: boolean; coreStepsComplete?: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const persona = personaOverride ?? await derivePersona();
  if (!persona) return { success: false, error: "No qualifying org membership" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const now = new Date().toISOString();

  const { error } = await db.from("user_onboarding_progress").upsert(
    {
      user_id: auth.ctx.userId,
      persona,
      step_key: stepKey,
      completed_at: now,
      journey_started_at: now,
      updated_at: now,
    },
    { onConflict: "user_id,persona,step_key" }
  );

  if (error) {
    console.error("[onboarding] completeOnboardingStep failed:", error);
    return { success: false, error: "Failed to mark step complete" };
  }

  // Check if all core steps for this persona are done
  const { data: completedRows } = await db
    .from("user_onboarding_progress")
    .select("step_key")
    .eq("user_id", auth.ctx.userId)
    .eq("persona", persona)
    .not("completed_at", "is", null);

  const completedKeys = new Set(
    ((completedRows ?? []) as { step_key: string }[]).map((r) => r.step_key)
  );
  const coreSteps = CORE_STEPS_BY_PERSONA[persona];
  const coreStepsComplete = coreSteps.every((k) => completedKeys.has(k));

  if (coreStepsComplete) {
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
// ─────────────────────────────────────────────────────────────────────────────

export async function resetMyOnboarding(): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const isDev = process.env.NODE_ENV === "development";
  const isSuperAdmin = auth.ctx.globalRole === "super_admin";
  if (!isDev && !isSuperAdmin) {
    return { success: false, error: "Reset only available in dev or for super admins" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const now = new Date().toISOString();

  // Wipe ALL persona rows for this user
  const { error: deleteError } = await db
    .from("user_onboarding_progress")
    .delete()
    .eq("user_id", auth.ctx.userId);

  if (deleteError) {
    console.error("[onboarding] resetMyOnboarding delete failed:", deleteError);
    return { success: false, error: "Failed to clear progress rows" };
  }

  await (createAdminClient() as any)
    .from("users")
    .update({ onboarding_completed: false, updated_at: now })
    .eq("id", auth.ctx.userId);

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get all steps for current user
// ─────────────────────────────────────────────────────────────────────────────

export async function getMyOnboardingProgress(): Promise<{
  success: boolean;
  steps?: OnboardingStep[];
  persona?: Persona | null;
  coreStepsComplete?: boolean;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const persona = await derivePersona();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;

  const query = db
    .from("user_onboarding_progress")
    .select("*")
    .eq("user_id", auth.ctx.userId)
    .order("created_at", { ascending: true });

  if (persona) query.eq("persona", persona);

  const { data, error } = await query;

  if (error) {
    console.error("[onboarding] getMyOnboardingProgress failed:", error);
    return { success: false, error: "Failed to fetch progress" };
  }

  const steps = (data ?? []) as OnboardingStep[];
  const completedKeys = new Set(steps.filter((s) => s.completed_at).map((s) => s.step_key));
  const coreSteps = persona ? CORE_STEPS_BY_PERSONA[persona] : [];
  const coreStepsComplete = coreSteps.every((k) => completedKeys.has(k));

  return { success: true, steps, persona, coreStepsComplete };
}
