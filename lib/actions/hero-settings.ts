"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { HERO_KINDS, type HeroKind } from "@/lib/hero-kinds";

export interface ActionResult {
  success: boolean;
  error?: string;
}

/** cycle_interval_ms's DB CHECK is 3000-60000 — mirrored here so the form gets a clean error instead of a raw Postgres constraint message. */
const MIN_INTERVAL_MS = 3000;
const MAX_INTERVAL_MS = 60000;

export async function updateHeroCycleInterval(intervalMs: number): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
    return { success: false, error: `Interval must be between ${MIN_INTERVAL_MS / 1000}s and ${MAX_INTERVAL_MS / 1000}s.` };
  }

  const db = createAdminClient();
  const { data: row, error: lookupError } = await db.from("hero_area_config").select("id").limit(1).single();
  if (lookupError || !row) return { success: false, error: lookupError?.message ?? "hero_area_config row not found" };

  const { error } = await db
    .from("hero_area_config")
    .update({ cycle_interval_ms: Math.round(intervalMs), updated_at: new Date().toISOString(), updated_by: auth.ctx.userId })
    .eq("id", row.id);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "hero_area_interval_updated",
    entityType: "hero_area_config",
    actorId: auth.ctx.userId,
    details: { cycle_interval_ms: intervalMs },
  });

  revalidatePath("/");
  return { success: true };
}

export async function updateHeroSlideKindSettings(
  kind: HeroKind,
  settings: { enabled: boolean; weight: number }
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!HERO_KINDS.includes(kind)) {
    return { success: false, error: `Unknown slide kind: ${kind}` };
  }
  if (!Number.isFinite(settings.weight) || settings.weight < 0) {
    return { success: false, error: "Weight must be a non-negative number." };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("hero_slide_settings")
    .update({
      enabled: settings.enabled,
      weight: Math.round(settings.weight),
      updated_at: new Date().toISOString(),
      updated_by: auth.ctx.userId,
    })
    .eq("kind", kind);

  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "hero_slide_kind_updated",
    entityType: "hero_slide_settings",
    entityId: kind,
    actorId: auth.ctx.userId,
    details: settings,
  });

  revalidatePath("/");
  return { success: true };
}

export interface ConferenceSlideContentInput {
  title: string;
  statValue: string;
  statLabel: string;
  includedItems: string[];
  ctaTemplates: {
    admin: string;
    partner: string;
    member: string;
  };
}

/**
 * Writes the conference kind's site_content rows directly (no Tier2
 * second-signer queue) — this form is already nav- and code-gated to
 * super_admin only, and super_admin writes bypass that queue everywhere
 * else in the app too (lib/actions/update-field.ts), so this isn't a new
 * exception. All fields are plain text writes — no numeric coercion like
 * the generic Toolkit popover applies, since a numeric-looking stat value
 * (e.g. "8") must stay a string in this text column.
 */
export async function updateConferenceSlideContent(input: ConferenceSlideContentInput): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const now = new Date().toISOString();
  const updatedBy = auth.ctx.userId;

  const writes = await Promise.all([
    db.from("site_content").update({ title: input.title, updated_at: now, updated_by: updatedBy }).eq("section", "conference_slide"),
    db.from("site_content").update({ title: input.statValue, subtitle: input.statLabel, updated_at: now, updated_by: updatedBy }).eq("section", "conference_slide_stats"),
    db.from("site_content").update({ body: input.includedItems.map((s) => s.trim()).filter(Boolean).join("\n"), updated_at: now, updated_by: updatedBy }).eq("section", "conference_slide_included"),
    db.from("site_content").update({ body: input.ctaTemplates.admin, updated_at: now, updated_by: updatedBy }).eq("section", "conference_slide_cta_admin"),
    db.from("site_content").update({ body: input.ctaTemplates.partner, updated_at: now, updated_by: updatedBy }).eq("section", "conference_slide_cta_partner"),
    db.from("site_content").update({ body: input.ctaTemplates.member, updated_at: now, updated_by: updatedBy }).eq("section", "conference_slide_cta_member"),
  ]);

  const failed = writes.find((w) => w.error);
  if (failed?.error) return { success: false, error: failed.error.message };

  await logAuditEventSafe({
    action: "hero_conference_content_updated",
    entityType: "site_content",
    entityId: "conference_slide",
    actorId: auth.ctx.userId,
    details: { title: input.title, statValue: input.statValue, statLabel: input.statLabel, includedItemsCount: input.includedItems.length },
  });

  revalidatePath("/");
  return { success: true };
}
