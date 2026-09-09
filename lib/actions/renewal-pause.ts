"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

// NOTE: "use server" modules may only export async functions — the shared
// pause predicate and its types live in lib/renewal/notification-pause.ts and
// are imported directly by the jobs and by client components.

/** Longest pause we will set in one go, in days. */
const MAX_PAUSE_DAYS = 120;

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function addDaysISO(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().split("T")[0];
}

/**
 * Pause membership renewal notifications for one org until a date.
 *
 * Suppresses outbound renewal mail and nothing else — see
 * lib/renewal/notification-pause.ts for exactly what a pause does and does
 * not touch. The membership, its expiry, its invoices and their balances are
 * all left alone, and the grace/lock countdown keeps running underneath.
 *
 * The end date is required and bounded. An unbounded pause is not a pause;
 * it is a permanent exemption that nobody remembers to undo, and the org
 * silently drops out of the renewal chase forever.
 */
export async function setRenewalNotificationPauseAction(input: {
  organizationId: string;
  /** Inclusive last day of the pause, YYYY-MM-DD. */
  pausedUntil: string;
  reason: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const pausedUntil = input.pausedUntil?.split("T")[0] ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pausedUntil)) {
    return { success: false, error: "Pause end date must be a valid date." };
  }
  if (pausedUntil < todayISO()) {
    return { success: false, error: "Pause end date is in the past." };
  }
  if (pausedUntil > addDaysISO(MAX_PAUSE_DAYS)) {
    return {
      success: false,
      error: `A pause can run at most ${MAX_PAUSE_DAYS} days. Set a shorter one and extend it if the payment still hasn't landed.`,
    };
  }

  // A pause is a judgement call someone made about a specific org, and the
  // only person who can explain it later is whoever made it. An empty reason
  // leaves a silenced org and no way to tell a payment-in-transit from a
  // mistake.
  const reason = input.reason.trim();
  if (!reason) {
    return { success: false, error: "Give a reason — it's the only record of why this org went quiet." };
  }

  // Admin client: a session-scoped write here returns zero rows with a null
  // error and reports success, so the pause would silently not happen.
  const db = createAdminClient();
  const now = new Date().toISOString();

  const { data: before } = await db
    .from("organizations")
    .select("id, name, renewal_notifications_paused_until, renewal_pause_reason")
    .eq("id", input.organizationId)
    .maybeSingle();

  if (!before) return { success: false, error: "Organization not found." };

  const { error } = await db
    .from("organizations")
    .update({
      renewal_notifications_paused_until: pausedUntil,
      renewal_pause_reason: reason,
      renewal_pause_set_by: auth.ctx.userId ?? null,
      renewal_pause_set_at: now,
    })
    .eq("id", input.organizationId);

  if (error) return { success: false, error: error.message };

  await writePauseAudit(db, {
    action: "renewal_pause.set",
    organizationId: input.organizationId,
    organizationName: before.name,
    actorId: auth.ctx.userId ?? null,
    details: {
      paused_until: pausedUntil,
      reason,
      previous_paused_until: before.renewal_notifications_paused_until,
      previous_reason: before.renewal_pause_reason,
    },
  });

  revalidatePath("/admin/membership");
  revalidatePath("/admin/renewals");
  return { success: true };
}

/** Lift a pause immediately — the chase resumes on the next job run. */
export async function clearRenewalNotificationPauseAction(input: {
  organizationId: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();

  const { data: before } = await db
    .from("organizations")
    .select("id, name, renewal_notifications_paused_until, renewal_pause_reason")
    .eq("id", input.organizationId)
    .maybeSingle();

  if (!before) return { success: false, error: "Organization not found." };

  const { error } = await db
    .from("organizations")
    .update({
      renewal_notifications_paused_until: null,
      renewal_pause_reason: null,
      renewal_pause_set_by: null,
      renewal_pause_set_at: null,
    })
    .eq("id", input.organizationId);

  if (error) return { success: false, error: error.message };

  await writePauseAudit(db, {
    action: "renewal_pause.clear",
    organizationId: input.organizationId,
    organizationName: before.name,
    actorId: auth.ctx.userId ?? null,
    details: {
      previous_paused_until: before.renewal_notifications_paused_until,
      previous_reason: before.renewal_pause_reason,
    },
  });

  revalidatePath("/admin/membership");
  revalidatePath("/admin/renewals");
  return { success: true };
}

/**
 * Record the pause change. Fire and forget, same contract as updateField's
 * audit write: a lost audit row is bad, a refused pause is worse.
 */
async function writePauseAudit(
  db: ReturnType<typeof createAdminClient>,
  entry: {
    action: string;
    organizationId: string;
    organizationName: string | null;
    actorId: string | null;
    details: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    action: entry.action,
    entity_type: "organizations",
    entity_id: entry.organizationId,
    actor_id: entry.actorId,
    actor_type: "user",
    details: {
      organization_id: entry.organizationId,
      entity_name: entry.organizationName,
      ...entry.details,
    },
  });
  if (error) console.warn("[renewal-pause] audit write failed:", error.message);
}
