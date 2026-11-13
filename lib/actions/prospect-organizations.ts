"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guards";
import { ORG_TYPE, PROSPECT_ORG_TYPES } from "@/lib/constants/org-types";
import { findDuplicateOrganizations, type DuplicateOrgMatch } from "@/lib/applications/duplicate-orgs";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { slugify } from "@/lib/utils";

/**
 * Staff adding a store or a vendor we would like to have.
 *
 * Only the company is created here. Its people are added on its own page with
 * the toolkit's "Add a new contact", tagged "Prospect (never joined)", which is
 * how a tagged contact already reaches the "Tagged Contacts" email audience.
 * No membership row, no billing, no login: a prospect has joined nothing.
 *
 * ⛔ The duplicate check is the approval flow's own (findDuplicateOrganizations),
 * so "do we already have them?" has one answer. A match stops the add and links
 * to what we have; staff confirm only if it is genuinely a different company.
 */

type Result =
  | { success: true; slug: string }
  | { success: false; error: string; duplicates?: Array<Pick<DuplicateOrgMatch, "id" | "name" | "type"> & { slug: string | null }> };

const TENANT_ID = "29300837-1d49-45b4-bd09-1c4525c409d1"; // the org default tenant, as applications.ts

export async function createProspectOrganization(params: {
  name: string;
  kind: "member" | "partner";
  confirmDuplicates?: boolean;
}): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const name = params.name.trim().replace(/\s+/g, " ");
  if (!name) return { success: false, error: "Enter the company's name." };
  const type = params.kind === "member" ? ORG_TYPE.prospectiveMember : ORG_TYPE.prospectivePartner;
  if (!PROSPECT_ORG_TYPES.includes(type)) return { success: false, error: "Unknown kind." };

  const db = createAdminClient();

  if (!params.confirmDuplicates) {
    const duplicates = await findDuplicateOrganizations(db, { name, email: null, website: null });
    if (duplicates.length > 0) {
      const { data: slugs } = await db
        .from("organizations")
        .select("id, slug")
        .in("id", duplicates.map((d) => d.id));
      const slugById = new Map((slugs ?? []).map((o) => [o.id as string, o.slug as string | null]));
      return {
        success: false,
        error: "We may already have this company.",
        duplicates: duplicates.map((d) => ({ id: d.id, name: d.name, type: d.type, slug: slugById.get(d.id) ?? null })),
      };
    }
  }

  // Same slug rule as approving an application.
  const base = slugify(name);
  if (!base) return { success: false, error: "That name has no letters or numbers to make a page address from." };
  const { data: taken } = await db.from("organizations").select("id").eq("slug", base).maybeSingle();
  const slug = taken ? `${base}-${Date.now()}` : base;

  const id = crypto.randomUUID();
  const { error } = await db.from("organizations").insert({
    id,
    name,
    slug,
    type,
    tenant_id: TENANT_ID,
    updated_at: new Date().toISOString(),
  });
  if (error) return { success: false, error: `Could not add the company: ${error.message}` };

  await logAuditEventSafe({
    action: "prospect_organization_created",
    entityType: "organization",
    entityId: id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { name, type },
  });

  return { success: true, slug };
}
