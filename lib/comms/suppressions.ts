// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Unsubscribe / CASL Suppression
// A comms_suppressions row means "don't send this email commercial
// content in this category" — category='all' is the sentinel for a
// full unsubscribe from every commercial category.
//
// `kind` says WHY, and that decides whether transactional mail is also
// blocked. Transactional templates still ignore preferences — CASL
// doesn't require (or permit blocking) those — but they do NOT ignore a
// dead mailbox. "This person opted out" and "this address does not
// exist" are unrelated facts, and only the first is a preference a legal
// exemption can override. Mail to a hard-bounced address cannot arrive
// no matter how transactional it is; it just burns sending reputation.
// See lib/email/send.ts, where the bounce block is enforced for every
// send path rather than only campaign sends.
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import type { ResolvedRecipient, TemplateCategory } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

export const GLOBAL_SUPPRESSION_CATEGORY = "all";

/**
 * Why an address is suppressed.
 *
 * - `unsubscribe` — a stated preference. Commercial mail only.
 * - `bounce`      — the mailbox is gone (Resend reports "Permanent").
 *                   Blocks everything, transactional included.
 * - `complaint`   — marked us as spam. Deliberately treated as an
 *                   unsubscribe: it is a preference, however emphatic, and
 *                   transactional mail stays legally permitted. Kept as its
 *                   own value so this can be revisited without a backfill.
 */
export type SuppressionKind = "unsubscribe" | "bounce" | "complaint";

/** The only kind that stops a transactional send. */
export const TRANSACTIONAL_BLOCKING_KIND: SuppressionKind = "bounce";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Removes recipients who've opted out of this category (or unsubscribed
 * globally) — a no-op for transactional sends, which should never call
 * this. Batched: one query for every email in the list, not one per
 * recipient.
 *
 * This is the PREFERENCE filter and it is category-aware, so it stays
 * commercial-only. The separate deliverability filter that transactional
 * sends do respect is `loadHardBouncedEmails`, enforced centrally in
 * lib/email/send.ts.
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
  reason?: string,
  kind: SuppressionKind = "unsubscribe"
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const normalized = normalizeEmail(email);

  // A bounce must never be downgraded by a later unsubscribe. The upsert
  // overwrites every column, so an address that hard-bounced and then hit
  // "unsubscribe from all" would silently stop blocking transactional mail
  // — the mailbox is still gone. Escalation to `bounce` is always allowed;
  // the reverse requires an explicit resubscribe (which deletes the row).
  let effectiveKind = kind;
  if (kind !== TRANSACTIONAL_BLOCKING_KIND) {
    const { data: existing } = await supabase
      .from("comms_suppressions")
      .select("kind")
      .eq("email", normalized)
      .eq("category", category)
      .maybeSingle();
    if (existing?.kind === TRANSACTIONAL_BLOCKING_KIND) {
      effectiveKind = TRANSACTIONAL_BLOCKING_KIND;
    }
  }

  const { error } = await supabase
    .from("comms_suppressions")
    .upsert(
      { email: normalized, category, reason: reason ?? null, kind: effectiveKind },
      { onConflict: "email,category" }
    );

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * The subset of `emails` whose mailbox is known to be dead.
 *
 * Deliberately ignores `category`: a hard bounce is a property of the
 * address, not of what we wanted to say to it. Fails OPEN — if the lookup
 * errors we return an empty set and let the mail go, because a database
 * hiccup must never silently stop transactional email.
 */
export async function loadHardBouncedEmails(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const unique = [...new Set(emails.map(normalizeEmail))];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("comms_suppressions")
    .select("email")
    .eq("kind", TRANSACTIONAL_BLOCKING_KIND)
    .in("email", unique);

  if (error) {
    console.error("[comms/suppressions] loadHardBouncedEmails error:", error);
    return new Set();
  }
  return new Set((data ?? []).map((r) => normalizeEmail(r.email as string)));
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
  kind: SuppressionKind;
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
    .select("id, email, category, reason, kind, created_at")
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
  // `kind` is a CHECK-constrained text column, so Postgres guarantees the
  // value but the generated types only say `string`. Narrow it here rather
  // than casting, so a value added to the constraint without updating
  // SuppressionKind degrades to the safe default instead of lying.
  return (data ?? []).map((row) => ({
    ...row,
    kind: isSuppressionKind(row.kind) ? row.kind : "unsubscribe",
  }));
}

function isSuppressionKind(value: string): value is SuppressionKind {
  return value === "unsubscribe" || value === "bounce" || value === "complaint";
}
