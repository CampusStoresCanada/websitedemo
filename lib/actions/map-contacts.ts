"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getViewerContext } from "@/lib/visibility/viewer";
import { loadVisibilityConfig, applyFieldMask } from "@/lib/visibility/engine";
import type { Contact } from "@/lib/types/db";

export interface MapContactEntry {
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
}

/**
 * Primary contacts for an org, field-masked per the current viewer's level
 * (public/member/partner/org_admin/admin) — same masking rules as an org
 * profile page. Used by the map explore panel, which is reachable by
 * anonymous visitors, so this must never return raw PII to a viewer who
 * hasn't earned it.
 */
export async function getPrimaryContactsForMap(
  orgId: string,
  orgType: string | null
): Promise<MapContactEntry[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contacts")
    .select("id, name, role_title, work_email, email, work_phone_number, phone, profile_picture_url")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .eq("is_primary", true)
    .order("name");

  if (error || !data) return [];

  const viewer = await getViewerContext();
  const config = await loadVisibilityConfig();
  const isOwnOrg = viewer.viewerOrgAdminIds.includes(orgId);

  return data.map((row) => {
    const masked = applyFieldMask(
      row as unknown as Record<string, unknown>,
      viewer.viewerLevel,
      config,
      "contacts",
      isOwnOrg,
      orgType
    ) as Partial<Contact>;

    return {
      name: (masked.name as string) || "Unknown",
      roleTitle: (masked.role_title as string) ?? null,
      email: (masked.work_email as string) || (masked.email as string) || null,
      phone: (masked.work_phone_number as string) || (masked.phone as string) || null,
      avatarUrl: row.profile_picture_url ?? null,
    };
  });
}
