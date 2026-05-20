"use server";

import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePartnerLinks, type PartnerLink } from "@/lib/partner-links";
import type { Json } from "@/lib/database.types";
import { logAuditEventSafe } from "@/lib/ops/audit";

interface ManageLinksResult {
  success: boolean;
  links?: PartnerLink[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Add a link
// ---------------------------------------------------------------------------

export async function addPartnerLink(
  orgId: string,
  link: PartnerLink
): Promise<ManageLinksResult> {
  const auth = await requireOrgAdminOrSuperAdmin(orgId);
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: org, error: fetchError } = await adminClient
    .from("organizations")
    .select("partner_links")
    .eq("id", orgId)
    .single();

  if (fetchError || !org) {
    return { success: false, error: "Organization not found" };
  }

  const existing = parsePartnerLinks(org.partner_links);
  // Prevent duplicates by id
  const updated = [...existing.filter((l) => l.id !== link.id), link];

  const { error: updateError } = await adminClient
    .from("organizations")
    .update({ partner_links: updated as unknown as Json })
    .eq("id", orgId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  await logAuditEventSafe({
    action: "partner_link_added",
    entityType: "organization",
    entityId: orgId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { link_id: link.id, link_type: link.type, label: link.label },
  });

  return { success: true, links: updated };
}

// ---------------------------------------------------------------------------
// Remove a link
// ---------------------------------------------------------------------------

export async function removePartnerLink(
  orgId: string,
  linkId: string
): Promise<ManageLinksResult> {
  const auth = await requireOrgAdminOrSuperAdmin(orgId);
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: org, error: fetchError } = await adminClient
    .from("organizations")
    .select("partner_links")
    .eq("id", orgId)
    .single();

  if (fetchError || !org) {
    return { success: false, error: "Organization not found" };
  }

  const existing = parsePartnerLinks(org.partner_links);
  const removing = existing.find((l) => l.id === linkId);
  const updated = existing.filter((l) => l.id !== linkId);

  const { error: updateError } = await adminClient
    .from("organizations")
    .update({ partner_links: updated as unknown as Json })
    .eq("id", orgId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // If it was a stored document, clean up the file too
  if (removing?.storage_path) {
    await adminClient.storage
      .from("partner-documents")
      .remove([removing.storage_path]);
  }

  await logAuditEventSafe({
    action: "partner_link_removed",
    entityType: "organization",
    entityId: orgId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { link_id: linkId },
  });

  return { success: true, links: updated };
}

// ---------------------------------------------------------------------------
// Reorder links
// ---------------------------------------------------------------------------

export async function reorderPartnerLinks(
  orgId: string,
  orderedIds: string[]
): Promise<ManageLinksResult> {
  const auth = await requireOrgAdminOrSuperAdmin(orgId);
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: org, error: fetchError } = await adminClient
    .from("organizations")
    .select("partner_links")
    .eq("id", orgId)
    .single();

  if (fetchError || !org) {
    return { success: false, error: "Organization not found" };
  }

  const existing = parsePartnerLinks(org.partner_links);
  const byId = new Map(existing.map((l) => [l.id, l]));
  const updated = orderedIds
    .map((id) => byId.get(id))
    .filter((l): l is PartnerLink => Boolean(l));

  // Append any links not in the ordered list at the end (safety net)
  const orderedSet = new Set(orderedIds);
  for (const link of existing) {
    if (!orderedSet.has(link.id)) updated.push(link);
  }

  const { error: updateError } = await adminClient
    .from("organizations")
    .update({ partner_links: updated as unknown as Json })
    .eq("id", orgId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true, links: updated };
}

// ---------------------------------------------------------------------------
// Update a single link's metadata (label, visibility, url)
// ---------------------------------------------------------------------------

export async function updatePartnerLink(
  orgId: string,
  linkId: string,
  patch: Partial<Pick<PartnerLink, "label" | "visibility" | "url">>
): Promise<ManageLinksResult> {
  const auth = await requireOrgAdminOrSuperAdmin(orgId);
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  const { data: org, error: fetchError } = await adminClient
    .from("organizations")
    .select("partner_links")
    .eq("id", orgId)
    .single();

  if (fetchError || !org) {
    return { success: false, error: "Organization not found" };
  }

  const existing = parsePartnerLinks(org.partner_links);
  const updated = existing.map((l) =>
    l.id === linkId ? { ...l, ...patch } : l
  );

  const { error: updateError } = await adminClient
    .from("organizations")
    .update({ partner_links: updated as unknown as Json })
    .eq("id", orgId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true, links: updated };
}
