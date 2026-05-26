"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";
import type { PendingContentChange } from "@/lib/database.types";

const TOKEN_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours — matches pending change lifetime

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function generateRawToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Create a review token for an eligible approver
// ─────────────────────────────────────────────────────────────────────────────

export async function createReviewToken(
  changeId: string,
  intendedForUserId: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString();

  const adminClient = createAdminClient();

  const { error } = await adminClient
    .from("content_change_tokens")
    .insert({
      change_id: changeId,
      token_hash: tokenHash,
      intended_for: intendedForUserId,
      expires_at: expiresAt,
    });

  if (error) {
    console.error("[content-change-tokens] createReviewToken failed:", error);
    return { success: false, error: "Failed to create review token" };
  }

  return { success: true, token: rawToken };
}

// ─────────────────────────────────────────────────────────────────────────────
// Peek — validate a token without consuming it.
// Call on page load to activate review mode and scroll to the anchor.
// Does NOT mark the token as used.
// ─────────────────────────────────────────────────────────────────────────────

export async function peekReviewToken(rawToken: string): Promise<{
  valid: boolean;
  reason?: "not_found" | "used" | "expired" | "change_not_pending";
  change?: PendingContentChange;
  intendedForUserId?: string;
}> {
  const tokenHash = hashToken(rawToken);
  const adminClient = createAdminClient();

  const { data: tokenRow, error } = await adminClient
    .from("content_change_tokens")
    .select("*, change:pending_content_changes(*)")
    .eq("token_hash", tokenHash)
    .single();

  if (error || !tokenRow) return { valid: false, reason: "not_found" };
  if (tokenRow.used_at) return { valid: false, reason: "used" };
  if (new Date(tokenRow.expires_at) < new Date()) return { valid: false, reason: "expired" };

  const change = Array.isArray(tokenRow.change) ? tokenRow.change[0] : tokenRow.change;
  if (!change || change.status !== "pending") {
    return { valid: false, reason: "change_not_pending" };
  }

  return {
    valid: true,
    change: change as PendingContentChange,
    intendedForUserId: tokenRow.intended_for,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Consume — mark a token as used.
// Call immediately before approve/reject fires so the token can't be reused
// even if the network request fails halfway through.
// Returns false if the token was already consumed (race condition guard).
// ─────────────────────────────────────────────────────────────────────────────

export async function consumeReviewToken(rawToken: string): Promise<{ ok: boolean }> {
  const tokenHash = hashToken(rawToken);
  const adminClient = createAdminClient();

  // Re-check used_at atomically and set it
  const { data: tokenRow } = await adminClient
    .from("content_change_tokens")
    .select("id, used_at")
    .eq("token_hash", tokenHash)
    .single();

  if (!tokenRow) return { ok: false };
  if (tokenRow.used_at) return { ok: false }; // already consumed

  await adminClient
    .from("content_change_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", tokenRow.id);

  return { ok: true };
}
