"use server";

import { requireAuthenticated } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import type { AnySnapshot, SnapshotRecord, SnapshotType } from "@/lib/snapshots/types";
import {
  captureOrgProfileSnapshot,
  captureEventSnapshot,
  captureConferenceSnapshot,
  captureResourcesSnapshot,
  capturePartnersSnapshot,
} from "@/lib/snapshots/capture";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateSnapshotParams {
  type: SnapshotType;
  snapshot: AnySnapshot;
  pageUrl: string;
  pageTitle: string;
  /** Hours until expiry — default 96 (4 days) */
  expiryHours?: number;
  note?: string;
  recipientEmail?: string;
}

export interface CreateSnapshotResult {
  id?: string;
  error?: string;
}

export async function createSnapshot({
  type,
  snapshot,
  pageUrl,
  pageTitle,
  expiryHours = 96,
  note,
  recipientEmail,
}: CreateSnapshotParams): Promise<CreateSnapshotResult> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase, userId } = auth.ctx;

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + expiryHours);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("page_snapshots")
    .insert({
      type,
      snapshot,
      page_url: pageUrl,
      page_title: pageTitle,
      note: note?.trim() || null,
      created_by: userId,
      recipient_email: recipientEmail || null,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("createSnapshot error:", error);
    return { error: "Failed to create snapshot" };
  }

  return { id: data.id };
}

// ---------------------------------------------------------------------------
// Resolve (public — no auth required)
// ---------------------------------------------------------------------------

export async function resolveSnapshot(id: string): Promise<{
  valid: boolean;
  record?: SnapshotRecord;
  reason?: "not_found" | "expired";
}> {
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("page_snapshots")
    .select(
      "id, type, snapshot, page_url, page_title, note, created_by, recipient_email, expires_at, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return { valid: false, reason: "not_found" };

  const row = data as SnapshotRecord;

  // Normalize Supabase timestamptz (may lack Z suffix)
  const expiresStr =
    row.expires_at.endsWith("Z") || row.expires_at.includes("+")
      ? row.expires_at
      : row.expires_at.replace(" ", "T") + "Z";

  if (new Date(expiresStr) < new Date()) {
    return { valid: false, reason: "expired", record: row };
  }

  return { valid: true, record: row };
}

// ---------------------------------------------------------------------------
// Member search (fuzzy, for internal sharing recipient picker)
// ---------------------------------------------------------------------------

export interface MemberSearchResult {
  id: string;
  display_name: string | null;
  /** May be empty string — email is resolved server-side at send time */
  email: string;
  organization_name: string | null;
}

export async function searchMembersForShare(
  query: string
): Promise<MemberSearchResult[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];

  const { supabase } = auth.ctx;
  const q = query.trim();
  if (q.length < 2) return [];

  // Search by display_name — email is resolved at send time, not here
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .ilike("display_name", `%${q}%`)
    .limit(10);

  return (data ?? []).map((p) => ({
    id: p.id,
    display_name: p.display_name,
    email: "", // resolved server-side in shareInternally
    organization_name: null,
  }));
}

// ---------------------------------------------------------------------------
// Capture + create in one shot (called from ShareModal)
// ---------------------------------------------------------------------------

export interface CaptureAndCreateParams {
  pathname: string;
  pageTitle: string;
  note?: string;
  recipientEmail?: string;
  expiryHours?: number;
}

export async function captureAndCreateSnapshot({
  pathname,
  pageTitle,
  note,
  recipientEmail,
  expiryHours = 96,
}: CaptureAndCreateParams): Promise<{ id?: string; error?: string }> {
  let snapshot: AnySnapshot | null = null;
  let type: SnapshotType = "resources"; // default fallback

  // Route by URL pattern
  const orgMatch = pathname.match(/^\/(?:members|org)\/([^/?#]+)/);
  const eventMatch = pathname.match(/^\/events\/([^/?#]+)/);
  // /conference/[year]/[edition] — look up by year+edition_code
  const conferenceMatch = pathname.match(/^\/conference\/(\d{4})\/([^/?#]+)/);
  const resourcesMatch = pathname.startsWith("/resources");
  const partnersMatch = pathname.startsWith("/partners");

  if (orgMatch) {
    type = "org_profile";
    snapshot = await captureOrgProfileSnapshot(orgMatch[1]);
  } else if (eventMatch) {
    type = "event";
    snapshot = await captureEventSnapshot(eventMatch[1]);
  } else if (conferenceMatch) {
    type = "conference";
    snapshot = await captureConferenceSnapshot(conferenceMatch[1], conferenceMatch[2]);
  } else if (resourcesMatch) {
    type = "resources";
    snapshot = await captureResourcesSnapshot(pathname);
  } else if (partnersMatch) {
    type = "partners";
    snapshot = await capturePartnersSnapshot();
  } else {
    // Generic fallback — treat as resources (metadata only)
    type = "resources";
    snapshot = await captureResourcesSnapshot(pathname);
  }

  if (!snapshot) {
    return { error: "Could not capture page data" };
  }

  return createSnapshot({
    type,
    snapshot,
    pageUrl: pathname,
    pageTitle,
    note,
    recipientEmail,
    expiryHours,
  });
}

// ---------------------------------------------------------------------------
// Share internally: capture + create + notify recipient via Circle DM/email
// ---------------------------------------------------------------------------

export interface ShareInternallyParams {
  pathname: string;
  pageTitle: string;
  /** Profile/user ID of the recipient — email is resolved server-side */
  recipientId: string;
  note?: string;
  elementSelector?: string;
  elementEndSelector?: string;
  elementText?: string;
}

export async function shareInternally({
  pathname,
  pageTitle,
  recipientId,
  note,
  elementSelector,
  elementEndSelector,
  elementText,
}: ShareInternallyParams): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "Not authenticated" };

  const { supabase, userId, userEmail } = auth.ctx;

  // Resolve recipient email via admin API
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const adminClient = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recipientAuthData } = await (adminClient as any).auth.admin.getUserById(recipientId);
  const recipientEmail: string = recipientAuthData?.user?.email ?? "";
  if (!recipientEmail) {
    return { success: false, error: "Could not resolve recipient email" };
  }

  // Get sender's display name
  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();
  const senderName = senderProfile?.display_name ?? userEmail ?? "A CSC member";

  // Create the share record so recipient can see the highlight context
  const { createInternalShare } = await import("@/lib/actions/internal-shares");
  const shareResult = await createInternalShare({
    recipientId,
    pageUrl: pathname,
    pageTitle,
    note,
    elementSelector,
    elementEndSelector,
    elementText,
  });

  if (shareResult.error || !shareResult.id) {
    return { success: false, error: shareResult.error ?? "Failed to create share record" };
  }

  // Build URL with ?ishare=<id> so recipient lands with highlight + panel
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const fullPageUrl = `${appUrl}${pathname}`;
  const shareUrl = `${fullPageUrl}${fullPageUrl.includes("?") ? "&" : "?"}ishare=${shareResult.id}`;

  // Send notification as the sender via headless JWT DM
  const { sendShareNotification } = await import("@/lib/circle/share-notify");
  const notifyResult = await sendShareNotification({
    senderUserId: userId,
    senderName,
    senderEmail: userEmail ?? "",
    recipientEmail,
    pageTitle,
    pageUrl: shareUrl,
    note,
  });

  // Update share record with delivery method
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("internal_shares")
    .update({ sent_via: notifyResult.method ?? "unknown" })
    .eq("id", shareResult.id);

  return { success: true };
}
