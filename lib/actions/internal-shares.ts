"use server";

import { requireAuthenticated } from "@/lib/auth/guards";

export interface InternalShareRecord {
  id: string;
  created_by: string;
  recipient_id: string | null;
  page_url: string;
  page_title: string;
  note: string | null;
  sent_via: string | null;
  element_selector: string | null;
  element_end_selector: string | null;
  element_text: string | null;
  created_at: string;
}

export interface CreateInternalShareParams {
  recipientId: string;
  pageUrl: string;
  pageTitle: string;
  note?: string;
  sentVia?: string;
  elementSelector?: string;
  elementEndSelector?: string;
  elementText?: string;
}

export async function createInternalShare(
  params: CreateInternalShareParams
): Promise<{ id?: string; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase, userId } = auth.ctx;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("internal_shares")
    .insert({
      created_by: userId,
      recipient_id: params.recipientId,
      page_url: params.pageUrl,
      page_title: params.pageTitle,
      note: params.note?.trim() || null,
      sent_via: params.sentVia || null,
      element_selector: params.elementSelector || null,
      element_end_selector: params.elementEndSelector || null,
      element_text: params.elementText?.slice(0, 500) || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[internal-shares] insert error:", error);
    return { error: "Failed to create share record" };
  }

  return { id: data.id };
}

/**
 * Fetch a single internal share for in-context display.
 * Only the recipient (or an admin) can read it.
 */
export async function getInternalShareById(
  shareId: string
): Promise<InternalShareRecord | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const { supabase, userId, globalRole } = auth.ctx;
  const isAdmin = ["admin", "super_admin"].includes(globalRole);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("internal_shares")
    .select(
      "id, created_by, recipient_id, page_url, page_title, note, sent_via, element_selector, element_end_selector, element_text, created_at"
    )
    .eq("id", shareId)
    .maybeSingle();

  if (error || !data) return null;

  // Only recipient or admin can view
  if (!isAdmin && data.recipient_id !== userId) return null;

  return data as InternalShareRecord;
}
