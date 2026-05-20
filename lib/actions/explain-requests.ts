"use server";

import { requireAuthenticated } from "@/lib/auth/guards";
import { sendExplainNotification } from "@/lib/circle/explain-dm";

interface SubmitExplainParams {
  pageUrl: string;
  note: string;
  elementText?: string;
  elementSelector?: string;
  /** Explicit org ID from data-org-id — bypasses URL-based detection when provided */
  organizationId?: string;
}

interface SubmitExplainResult {
  success: boolean;
  error?: string;
  requestId?: string;
}

/**
 * Submit an "explain" request — user is flagging something they don't understand.
 * Routes to the org admin (if on an org page) or CSC staff (for site-wide content).
 */
export async function submitExplainRequest({
  pageUrl,
  note,
  elementText,
  elementSelector,
  organizationId: explicitOrgId,
}: SubmitExplainParams): Promise<SubmitExplainResult> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) return { success: false, error: "You must be logged in" };

    const { supabase, userId, userEmail } = auth.ctx;

    // Get asker's display name
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();

    // Prefer explicit org ID from data-org-id attribute; fall back to URL parsing
    let organizationId: string | null = explicitOrgId ?? null;
    if (!organizationId) {
      const orgMatch = pageUrl.match(/\/(?:members|org)\/([^/?#]+)/);
      if (orgMatch) {
        const slug = orgMatch[1];
        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", slug)
          .single();
        if (org) organizationId = org.id;
      }
    }

    const { data, error } = await supabase
      .from("explain_requests")
      .insert({
        user_id: userId,
        page_url: pageUrl,
        organization_id: organizationId,
        element_text: elementText?.slice(0, 500) || null,
        element_selector: elementSelector || null,
        note: note.trim(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error inserting explain request:", error);
      return { success: false, error: "Failed to submit request" };
    }

    const notifyResult = await sendExplainNotification({
      askerUserId: userId,
      askerEmail: userEmail ?? "",
      askerName: profile?.display_name ?? null,
      organizationId,
      pageUrl,
      elementText: elementText ?? null,
      note: note.trim(),
      requestId: data.id,
    });

    void notifyResult;
    return { success: true, requestId: data.id };
  } catch (err) {
    console.error("Error submitting explain request:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

export interface ExplainRequestRecord {
  id: string;
  page_url: string;
  element_selector: string | null;
  element_text: string | null;
  note: string | null;
  status: string;
  created_at: string;
  user_id: string;
  organization_id: string | null;
}

/**
 * Fetch a single explain request for in-context review.
 * Admin/org-admin only.
 */
export async function getExplainRequestById(requestId: string): Promise<ExplainRequestRecord | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const { supabase, globalRole, orgAdminOrgIds } = auth.ctx;
  const isAdmin = ["admin", "super_admin"].includes(globalRole);
  const isOrgAdmin = orgAdminOrgIds.length > 0;
  if (!isAdmin && !isOrgAdmin) return null;

  const { data, error } = await supabase
    .from("explain_requests")
    .select("id, page_url, element_selector, element_text, note, status, created_at, user_id, organization_id")
    .eq("id", requestId)
    .single();

  if (error || !data) return null;

  // Org admins can only see requests for their orgs
  if (!isAdmin && data.organization_id) {
    if (!orgAdminOrgIds.includes(data.organization_id)) return null;
  }

  return data as ExplainRequestRecord;
}

/** Get all pending explain requests — admin only. */
export async function getExplainRequests(): Promise<{
  requests: Array<{
    id: string;
    page_url: string;
    organization_id: string | null;
    element_text: string | null;
    note: string | null;
    status: string;
    created_at: string;
    user_id: string;
  }>;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { requests: [], error: "Not authenticated" };

  const { supabase, globalRole } = auth.ctx;
  if (!["admin", "super_admin"].includes(globalRole)) {
    return { requests: [], error: "Forbidden" };
  }

  const { data, error } = await supabase
    .from("explain_requests")
    .select("id, page_url, organization_id, element_text, note, status, created_at, user_id")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { requests: [], error: "Failed to load requests" };
  return { requests: data ?? [] };
}
