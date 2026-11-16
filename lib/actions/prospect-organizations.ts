"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/guards";
import { ORG_TYPE, PROSPECT_ORG_TYPES } from "@/lib/constants/org-types";
import { findDuplicateOrganizations, type DuplicateOrgMatch } from "@/lib/applications/duplicate-orgs";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { slugify } from "@/lib/utils";
import { addContact } from "@/lib/actions/add-contact";
import { logRenewalContact } from "@/lib/renewal/outreach";
import { resolveBoardRenewalWindow } from "@/lib/renewal/board-report";

/**
 * Staff adding a store or a vendor we would like to have.
 *
 * The company, and optionally its first person, added through addContact (the
 * toolkit's "Add a new contact") tagged "Prospect (never joined)", which is how
 * a tagged contact already reaches the "Tagged Contacts" email audience. More
 * people are added on the company's page. No membership row, no billing, no
 * login: a prospect has joined nothing.
 *
 * From a contact inquiry (Admin > Contact Inquiries > Make a prospect), the
 * inquiry's message becomes the first entry in the company's call history, read
 * here from the inquiry itself rather than trusted from the form, and the
 * inquiry moves to "in progress".
 *
 * ⛔ The duplicate check is the approval flow's own (findDuplicateOrganizations),
 * so "do we already have them?" has one answer. A match stops the add and links
 * to what we have; staff confirm only if it is genuinely a different company.
 */

type Result =
  | { success: true; slug: string; warning?: string | null }
  | { success: false; error: string; duplicates?: Array<Pick<DuplicateOrgMatch, "id" | "name" | "type"> & { slug: string | null }> };

const TENANT_ID = "29300837-1d49-45b4-bd09-1c4525c409d1"; // the org default tenant, as applications.ts

export async function createProspectOrganization(params: {
  name: string;
  kind: "member" | "partner";
  confirmDuplicates?: boolean;
  person?: { name: string; email?: string; title?: string; phone?: string } | null;
  inquiryId?: string | null;
}): Promise<Result> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const name = params.name.trim().replace(/\s+/g, " ");
  if (!name) return { success: false, error: "Enter the company's name." };
  const type = params.kind === "member" ? ORG_TYPE.prospectiveMember : ORG_TYPE.prospectivePartner;
  if (!PROSPECT_ORG_TYPES.includes(type)) return { success: false, error: "Unknown kind." };

  const db = createAdminClient();

  if (!params.confirmDuplicates) {
    const duplicates = await findDuplicateOrganizations(db, {
      name,
      email: params.person?.email?.trim() || null,
      website: null,
    });
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

  // Their first person, through the one path that adds a contact.
  let personNote: string | null = null;
  const personName = params.person?.name?.trim();
  if (personName) {
    const added = await addContact({
      organizationId: id,
      name: personName,
      workEmail: params.person?.email?.trim() || undefined,
      roleTitle: params.person?.title?.trim() || undefined,
      workPhoneNumber: params.person?.phone?.trim() || undefined,
      tags: ["prospect"],
      invite: false,
    });
    if (!added.success) personNote = `The company was added, but not ${personName}: ${added.error}`;
  }

  if (params.inquiryId) {
    const { data: inquiry } = await db
      .from("contact_inquiries")
      .select("id, message, created_at")
      .eq("id", params.inquiryId)
      .maybeSingle();
    if (inquiry) {
      const today = new Date().toISOString().slice(0, 10);
      const window = await resolveBoardRenewalWindow(today);
      const received = String(inquiry.created_at).slice(0, 10);
      await logRenewalContact({
        organizationId: id,
        renewalYear: window?.renewalYear ?? new Date().getUTCFullYear() + 1,
        contactedBy: auth.ctx.userId,
        channel: "other",
        outcome: "other",
        note: `Contact form, ${received}: ${inquiry.message}`,
      });
      await db.from("contact_inquiries").update({ status: "in_progress" }).eq("id", inquiry.id).eq("status", "new");
    }
  }

  await logAuditEventSafe({
    action: "prospect_organization_created",
    entityType: "organization",
    entityId: id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { name, type, inquiryId: params.inquiryId ?? null },
  });

  return { success: true, slug, warning: personNote };
}
