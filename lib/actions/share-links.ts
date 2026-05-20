"use server";

import { requireAuthenticated } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export interface ShareLink {
  id: string;
  page_url: string;
  page_title: string;
  note: string | null;
  expires_at: string;
  max_uses: number;
  use_count: number;
  created_at: string;
}

/** Create a share link for a page. expiresInDays defaults to 30. */
export async function createShareLink(
  pageUrl: string,
  pageTitle: string,
  expiresInDays: number = 30,
  note?: string
): Promise<{ link?: ShareLink; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase, userId } = auth.ctx;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  const { data, error } = await supabase
    .from("share_links")
    .insert({
      created_by: userId,
      page_url: pageUrl,
      page_title: pageTitle,
      note: note?.trim() || null,
      expires_at: expiresAt.toISOString(),
    })
    .select("id, page_url, page_title, note, expires_at, max_uses, use_count, created_at")
    .single();

  if (error) return { error: "Failed to create share link" };
  return { link: data as ShareLink };
}

/** Get share links created by the current user. */
export async function getMyShareLinks(): Promise<{ links: ShareLink[]; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { links: [], error: "Not authenticated" };

  const { supabase, userId } = auth.ctx;
  const { data, error } = await supabase
    .from("share_links")
    .select("id, page_url, page_title, note, expires_at, max_uses, use_count, created_at")
    .eq("created_by", userId)
    .order("created_at", { ascending: false });

  if (error) return { links: [], error: "Failed to load share links" };
  return { links: data as ShareLink[] };
}

/** Delete a share link (only the creator can do this). */
export async function deleteShareLink(id: string): Promise<{ error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase, userId } = auth.ctx;
  const { error } = await supabase
    .from("share_links")
    .delete()
    .eq("id", id)
    .eq("created_by", userId);

  if (error) return { error: "Failed to delete share link" };
  return {};
}

/**
 * Validate and read a share link by ID (public — no auth required).
 * Also increments the use count via a security-definer function.
 */
export async function resolveShareLink(id: string): Promise<{
  valid: boolean;
  link?: ShareLink;
  reason?: "not_found" | "expired" | "max_uses";
}> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("share_links")
    .select("id, page_url, page_title, note, expires_at, max_uses, use_count, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return { valid: false, reason: "not_found" };

  const link = data as ShareLink;

  // Normalize Supabase timestamp (no Z suffix)
  const expiresStr = link.expires_at.endsWith("Z") || link.expires_at.includes("+")
    ? link.expires_at
    : link.expires_at.replace(" ", "T") + "Z";

  if (new Date(expiresStr) < new Date()) return { valid: false, reason: "expired", link };
  if (link.use_count >= link.max_uses) return { valid: false, reason: "max_uses", link };

  // Increment use count (security definer function — cast needed until types are regenerated)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).rpc("increment_share_link_use", { link_id: id });

  return { valid: true, link };
}
