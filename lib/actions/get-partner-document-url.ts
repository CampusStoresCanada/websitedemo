"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import { parsePartnerLinks, canViewLink } from "@/lib/partner-links";
import { getViewerContext } from "@/lib/visibility/viewer";

const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

interface GetPartnerDocumentUrlResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Server action called when a member clicks "Open" on a partner document.
 *
 * Security model:
 *   1. Re-derive viewer level on the server (never trust the client).
 *   2. Fetch the link entry from the org's partner_links to verify
 *      the storage_path (prevents path injection — clients only send a link id).
 *   3. Check viewer level against the link's visibility setting.
 *   4. Only then generate a short-lived signed URL using the service role key.
 *
 * The raw storage path is NEVER returned. The signed URL is time-limited.
 */
export async function getPartnerDocumentUrl(
  orgId: string,
  linkId: string
): Promise<GetPartnerDocumentUrlResult> {
  // Step 1: Get viewer level server-side
  const viewer = await getViewerContext();

  // Step 2: Fetch the org's partner_links (using admin client for reliability)
  const adminClient = createAdminClient();

  const { data: org, error: fetchError } = await adminClient
    .from("organizations")
    .select("partner_links")
    .eq("id", orgId)
    .single();

  if (fetchError || !org) {
    return { success: false, error: "Organization not found" };
  }

  const links = parsePartnerLinks(org.partner_links);
  const link = links.find((l) => l.id === linkId);

  if (!link) {
    return { success: false, error: "Link not found" };
  }

  if (!link.storage_path) {
    return { success: false, error: "This link is not a stored document" };
  }

  // Step 3: Permission check
  if (!canViewLink(link, viewer.viewerLevel)) {
    return {
      success: false,
      error: "You don't have permission to access this document",
    };
  }

  // Step 4: Generate signed URL — only if authorized
  const { data: signedData, error: signedError } = await adminClient.storage
    .from("partner-documents")
    .createSignedUrl(link.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    console.error("[get-partner-document-url] signed URL error", signedError);
    return { success: false, error: "Could not generate document URL" };
  }

  return { success: true, url: signedData.signedUrl };
}

// ---------------------------------------------------------------------------
// Server-side resolution — used in page.tsx to pre-resolve visible links
// without a client round-trip for publicly visible or member-pre-resolved links.
// ---------------------------------------------------------------------------

import type { ViewerLevel } from "@/lib/visibility/defaults";
import type { PartnerLink, ResolvedPartnerLink } from "@/lib/partner-links";

/**
 * Resolves partner_links for server-side rendering on the org profile page.
 *
 * - Filters out links the viewer can't see
 * - For storage_path entries, generates signed URLs (TTL: 1h)
 * - Returns the resolved list + whether any gated content exists
 *
 * Call this in page.tsx; pass the result to PartnerProfile.
 */
export async function resolvePartnerLinksForViewer(
  links: PartnerLink[],
  viewerLevel: ViewerLevel
): Promise<{
  visible: ResolvedPartnerLink[];
  hasGated: boolean;
  gatedVisibility: "member" | "org_admin" | null;
}> {
  const adminClient = createAdminClient();

  const visible: ResolvedPartnerLink[] = [];
  let hasGated = false;
  let lowestGatedVisibility: "member" | "org_admin" | null = null;

  for (const link of links) {
    if (!canViewLink(link, viewerLevel)) {
      hasGated = true;
      // Track what level would unlock the gated content
      if (link.visibility === "member" && lowestGatedVisibility !== "member") {
        lowestGatedVisibility = "member";
      } else if (
        link.visibility === "org_admin" &&
        lowestGatedVisibility === null
      ) {
        lowestGatedVisibility = "org_admin";
      }
      continue;
    }

    if (link.storage_path) {
      // Generate signed URL server-side
      const { data: signedData, error } = await adminClient.storage
        .from("partner-documents")
        .createSignedUrl(link.storage_path, SIGNED_URL_TTL_SECONDS);

      if (error || !signedData?.signedUrl) {
        console.error(
          "[resolvePartnerLinksForViewer] failed to sign",
          link.id,
          error
        );
        continue; // Skip broken documents silently
      }

      visible.push({
        id: link.id,
        type: link.type,
        label: link.label,
        visibility: link.visibility,
        href: signedData.signedUrl,
        isDocument: true,
      });
    } else if (link.url) {
      visible.push({
        id: link.id,
        type: link.type,
        label: link.label,
        visibility: link.visibility,
        href: link.url,
        isDocument: false,
      });
    }
  }

  return { visible, hasGated, gatedVisibility: lowestGatedVisibility };
}
