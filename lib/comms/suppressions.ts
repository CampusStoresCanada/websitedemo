// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Unsubscribe / CASL Suppression
// A comms_suppressions row means "don't send this email commercial
// content in this category" — category='all' is the sentinel for a
// full unsubscribe from every commercial category. Transactional
// templates (message_templates.is_transactional) never consult this at
// all — CASL doesn't require (or permit blocking) those.
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import type { ResolvedRecipient, TemplateCategory } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

export const GLOBAL_SUPPRESSION_CATEGORY = "all";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Removes recipients who've opted out of this category (or unsubscribed
 * globally) — a no-op for transactional sends, which should never call
 * this. Batched: one query for every email in the list, not one per
 * recipient.
 */
export async function filterSuppressedRecipients(
  supabase: AdminClient,
  recipients: ResolvedRecipient[],
  category: TemplateCategory | null
): Promise<ResolvedRecipient[]> {
  if (recipients.length === 0) return recipients;

  const emails = [...new Set(recipients.map((r) => normalizeEmail(r.email)))];
  const categoriesToCheck = category ? [GLOBAL_SUPPRESSION_CATEGORY, category] : [GLOBAL_SUPPRESSION_CATEGORY];

  const { data: suppressions, error } = await supabase
    .from("comms_suppressions")
    .select("email, category")
    .in("email", emails)
    .in("category", categoriesToCheck);

  if (error) {
    console.error("[comms/suppressions] filterSuppressedRecipients error:", error);
    return recipients;
  }
  if (!suppressions?.length) return recipients;

  const suppressedEmails = new Set(suppressions.map((s) => s.email));
  return recipients.filter((r) => !suppressedEmails.has(normalizeEmail(r.email)));
}

export async function unsubscribeEmail(
  email: string,
  category: TemplateCategory | typeof GLOBAL_SUPPRESSION_CATEGORY,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("comms_suppressions")
    .upsert(
      { email: normalizeEmail(email), category, reason: reason ?? null },
      { onConflict: "email,category" }
    );

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function resubscribeEmail(
  email: string,
  category: TemplateCategory | typeof GLOBAL_SUPPRESSION_CATEGORY
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("comms_suppressions")
    .delete()
    .eq("email", normalizeEmail(email))
    .eq("category", category);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/** Every category (including 'all', the global sentinel) this email is currently suppressed from. */
export async function getSuppressionsForEmail(email: string): Promise<string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("comms_suppressions")
    .select("category")
    .eq("email", normalizeEmail(email));

  if (error) {
    console.error("[comms/suppressions] getSuppressionsForEmail error:", error);
    return [];
  }
  return (data ?? []).map((s) => s.category);
}

export interface SuppressionRow {
  id: string;
  email: string;
  category: string;
  reason: string | null;
  created_at: string;
}

/** Admin listing — most recent first, optional email substring filter. */
export async function listSuppressions(options?: {
  search?: string;
  limit?: number;
}): Promise<SuppressionRow[]> {
  const supabase = createAdminClient();
  let q = supabase
    .from("comms_suppressions")
    .select("id, email, category, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 200);

  if (options?.search) {
    q = q.ilike("email", `%${normalizeEmail(options.search)}%`);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/suppressions] listSuppressions error:", error);
    return [];
  }
  return data ?? [];
}
