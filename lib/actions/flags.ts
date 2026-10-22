"use server";

import { requireAuthenticated, requireConferenceDeskAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export interface FlagRecord {
  id: string;
  page_url: string;
  element_selector: string | null;
  element_content: string | null;
  priority: "normal" | "high";
  note: string | null;
  status: string;
  flagger_name: string | null;
  flagger_email: string;
  created_at: string;
}

export interface ConferenceAsk {
  id: string;
  note: string | null;
  priority: string;
  status: string;
  flaggerName: string | null;
  pageUrl: string;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * The War Room's Asks: what people need from CSC staff during a conference.
 *
 * ⛔ No table of its own — the site's flags, read for one conference, exactly
 * as loadSurveyFlags reads them for the benchmarking survey. An ask is a flag
 * raised on any of this conference's admin pages: the War Room's own "add an
 * ask" box, or the toolkit's Flag on the desk or the badge page. One queue, so
 * an ask is answered from one place whichever page it was raised on.
 */
export async function loadConferenceAsks(conferenceId: string): Promise<ConferenceAsk[]> {
  const auth = await requireConferenceDeskAccess(conferenceId);
  if (!auth.ok) return [];
  const { data } = await createAdminClient()
    .from("flags")
    .select("id, note, priority, status, flagger_name, page_url, created_at, resolved_at")
    .like("page_url", `/admin/conference/${conferenceId}/%`)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []).map((r) => ({
    id: r.id,
    note: r.note,
    priority: r.priority,
    status: r.status,
    flaggerName: r.flagger_name,
    pageUrl: r.page_url,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  }));
}

/**
 * Fetch a single flag for admin review.
 * Returns null if the user doesn't have permission or the flag doesn't exist.
 */
export async function getFlagById(flagId: string): Promise<FlagRecord | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const { globalRole, orgAdminOrgIds } = auth.ctx;
  const isAdmin = ["admin", "super_admin"].includes(globalRole);
  const isOrgAdmin = orgAdminOrgIds.length > 0;
  if (!isAdmin && !isOrgAdmin) return null;

  const adminClient = createAdminClient();
  const query = adminClient
    .from("flags")
    .select("id, page_url, element_selector, element_content, priority, note, status, flagger_name, flagger_email, created_at, organization_id")
    .eq("id", flagId)
    .single();

  const { data, error } = await query;
  if (error || !data) return null;

  // Org admins can only review flags for their orgs
  if (!isAdmin && data.organization_id) {
    if (!orgAdminOrgIds.includes(data.organization_id)) return null;
  }

  return data as FlagRecord;
}

/**
 * Mark a flag as resolved.
 */
export async function resolveFlag(
  flagId: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "Not authenticated" };

  const { globalRole, orgAdminOrgIds, userId } = auth.ctx;
  const isAdmin = ["admin", "super_admin"].includes(globalRole);
  const isOrgAdmin = orgAdminOrgIds.length > 0;
  if (!isAdmin && !isOrgAdmin) return { success: false, error: "Forbidden" };

  const adminClient = createAdminClient();

  // Verify access
  const { data: flag } = await adminClient
    .from("flags")
    .select("organization_id")
    .eq("id", flagId)
    .single();

  if (!flag) return { success: false, error: "Flag not found" };

  if (!isAdmin && flag.organization_id && !orgAdminOrgIds.includes(flag.organization_id)) {
    return { success: false, error: "Forbidden" };
  }

  const { error } = await adminClient
    .from("flags")
    .update({
      status: "resolved",
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes?.trim() || null,
    })
    .eq("id", flagId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}
