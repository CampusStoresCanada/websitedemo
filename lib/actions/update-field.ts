"use server";

import { revalidatePath } from "next/cache";
import {
  canManageOrganization,
  requireAuthenticated,
} from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureKnownPerson, upsertPersonContact } from "@/lib/identity/lifecycle";
import {
  EDITABLE_COLUMNS,
  isTier2,
  editAnchorId,
  fieldDisplayLabel,
  type EditableTable,
} from "@/lib/editable-fields";
import { queueTier2Change } from "@/lib/actions/pending-content-changes";
import { sendContentChangeFyi } from "@/lib/email/send";

interface UpdateFieldParams {
  table: EditableTable;
  column: string;
  entityId: string;
  newValue: string | number | null;
  /** Pass the org's UUID when this field is on an org page (/org/[slug]).
   *  Org-page edits always write immediately (no queue).
   *  Tier 2 org-page edits still fire a passive FYI to super_admins. */
  orgId?: string;
  /** Human-readable name of the entity, for email/audit context. */
  entityDisplayName?: string;
  /** Page path for deep-link in emails, e.g. "/org/lakeland-college". */
  pageHref?: string;
}

export interface UpdateFieldResult {
  success: boolean;
  error?: string;
  previousValue?: string | number | null;
  /** Set when the change was queued for second-signer approval (Tier 2, no orgId). */
  pendingChangeId?: string;
  requiresApproval?: boolean;
}

type ContactIdentityRow = {
  id: string;
  organization_id: string | null;
  name: string;
  work_email: string | null;
  email: string | null;
  role_title: string | null;
  work_phone_number: string | null;
  phone: string | null;
  archived_at: string | null;
};

async function syncContactIdentity(contact: ContactIdentityRow): Promise<void> {
  if (!contact.organization_id || contact.archived_at) return;

  const person = await ensureKnownPerson({
    organizationId: contact.organization_id,
    name: contact.name,
    email: contact.work_email ?? contact.email ?? null,
    title: contact.role_title,
    workPhone: contact.work_phone_number,
    mobilePhone: contact.phone,
  });

  if (person.error || !person.personId) {
    console.warn(
      "[update-field] contact identity sync skipped:",
      person.error ?? "no person resolved"
    );
    return;
  }

  const contactSync = await upsertPersonContact({
    organizationId: contact.organization_id,
    personId: person.personId,
    name: contact.name,
    email: contact.work_email ?? contact.email ?? null,
    roleTitle: contact.role_title,
    phone: contact.phone,
    workPhone: contact.work_phone_number,
    contactType: ["directory"],
  });

  if (contactSync.error) {
    console.warn("[update-field] contact projection sync failed:", contactSync.error);
  }
}

/**
 * Update a single field in the database.
 * Used by the global Toolkit Edit feature.
 *
 * Security:
 * - Only admins (super_admin or org_admin for the org) can update
 * - Only columns in EDITABLE_COLUMNS (lib/editable-fields.ts) can be updated
 * - Entity ownership is verified before any write
 * - Writes use the admin client (bypasses RLS) — permission check is in app code
 *
 * Tier 2 behaviour:
 * - On org pages (orgId provided): always writes immediately, sends FYI to super_admins
 *   for Tier 2 fields (logos, URLs, action links)
 * - Outside org pages (no orgId): Tier 2 fields go to pending_content_changes queue
 */
export async function updateField({
  table,
  column,
  entityId,
  newValue,
  orgId,
  entityDisplayName,
  pageHref,
}: UpdateFieldParams): Promise<UpdateFieldResult> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { success: false, error: "You must be logged in to edit" };
    }
    const { supabase, userEmail } = auth.ctx;

    // 1. Validate column is in allowlist
    const allowedColumns = EDITABLE_COLUMNS[table] as readonly string[];
    if (!allowedColumns || !allowedColumns.includes(column)) {
      console.error(`Column ${table}.${column} is not editable`);
      return { success: false, error: "This field cannot be edited" };
    }

    // 2. Verify entity ownership and capture previous value
    let canEdit = false;
    let previousValue: string | number | null = null;
    let resolvedOrgId: string | null = orgId ?? null;
    let resolvedDisplayName: string = entityDisplayName ?? "";

    if (table === "organizations") {
      const { data: org } = await supabase
        .from("organizations")
        .select("id, name, slug, " + column)
        .eq("id", entityId)
        .single();

      if (!org) return { success: false, error: "Organization not found" };
      const orgData = org as unknown as Record<string, unknown>;
      previousValue = orgData[column] as string | number | null;
      resolvedOrgId = entityId;
      resolvedDisplayName = resolvedDisplayName || (orgData.name as string) || "";
      canEdit = canManageOrganization(auth.ctx, entityId);
    } else if (table === "contacts") {
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, name, organization_id, " + column)
        .eq("id", entityId)
        .single();

      if (!contact) return { success: false, error: "Contact not found" };
      const contactData = contact as unknown as Record<string, unknown>;
      previousValue = contactData[column] as string | number | null;
      const cOrgId = contactData.organization_id as string | null;
      resolvedOrgId = resolvedOrgId ?? cOrgId;
      resolvedDisplayName = resolvedDisplayName || (contactData.name as string) || "";
      const isOrgAdmin = Boolean(cOrgId && canManageOrganization(auth.ctx, cOrgId));
      // Members can edit their own contact fields (matched by email)
      const contactEmail = (contactData.work_email || contactData.email) as string | null;
      const isOwnContact = !!auth.ctx.userEmail && !!contactEmail &&
        contactEmail.toLowerCase() === auth.ctx.userEmail.toLowerCase();
      canEdit = isOrgAdmin || isOwnContact;
    } else if (table === "brand_colors") {
      const { data: color } = await supabase
        .from("brand_colors")
        .select("id, organization_id, " + column)
        .eq("id", entityId)
        .single();

      if (!color) return { success: false, error: "Brand color not found" };
      const colorData = color as unknown as Record<string, unknown>;
      previousValue = colorData[column] as string | number | null;
      const cOrgId = colorData.organization_id as string;
      resolvedOrgId = resolvedOrgId ?? cOrgId;
      canEdit = canManageOrganization(auth.ctx, cOrgId);
    } else if (table === "benchmarking") {
      const adminClient = createAdminClient();
      const { data: benchmark } = await adminClient
        .from("benchmarking")
        .select("id, organization_id, " + column)
        .eq("id", entityId)
        .single();

      if (!benchmark) return { success: false, error: "Benchmarking record not found" };
      const benchmarkData = benchmark as unknown as Record<string, unknown>;
      previousValue = benchmarkData[column] as string | number | null;
      const bOrgId = benchmarkData.organization_id as string;
      resolvedOrgId = resolvedOrgId ?? bOrgId;
      canEdit = canManageOrganization(auth.ctx, bOrgId);
    } else if (table === "site_content") {
      // site_content requires admin or super_admin
      const role = auth.ctx.globalRole;
      if (role !== "admin" && role !== "super_admin") {
        return { success: false, error: "You don't have permission to edit site content" };
      }
      const adminClient = createAdminClient();
      const { data: sc } = await adminClient
        .from("site_content")
        .select("id, " + column)
        .eq("id", entityId)
        .single();

      if (!sc) return { success: false, error: "Site content record not found" };
      const scData = sc as unknown as Record<string, unknown>;
      previousValue = scData[column] as string | number | null;
      canEdit = true;
    }

    if (!canEdit) {
      return { success: false, error: "You don't have permission to edit this" };
    }

    // 3. Tier 2 gate — only applies when outside an org-page context.
    // super_admins are the final authority and bypass the queue entirely.
    const isOrgPageEdit = Boolean(resolvedOrgId && orgId);
    const isSuperAdmin = auth.ctx.globalRole === "super_admin";
    if (isTier2(table, column) && !isOrgPageEdit && !isSuperAdmin) {
      // Queue for second-signer approval
      const anchor = editAnchorId(table, column, entityId);
      const result = await queueTier2Change({
        targetTable: table,
        targetColumn: column,
        targetEntityId: entityId,
        proposedValue: newValue,
        previousValue,
        entityDisplayName: resolvedDisplayName,
        fieldDisplayLabel: fieldDisplayLabel(column),
        pageHref: pageHref ?? null,
        anchorId: anchor,
        requestedBy: auth.ctx.userId,
      });

      if (!result.success) {
        return { success: false, error: result.error ?? "Failed to queue change for approval" };
      }

      return {
        success: true,
        requiresApproval: true,
        pendingChangeId: result.pendingChangeId,
        previousValue,
      };
    }

    // 4. Perform the write (Tier 1, or Tier 2 on org page)
    // Editing FTE directly is an explicit admin call — it should stick as
    // the org's public/priced number until the org's next benchmarking
    // submission naturally refreshes it (see submitBenchmarkingSurvey).
    const isManualFteEdit = table === "organizations" && column === "fte";
    const adminClient = createAdminClient();
    const { error: updateError } = await adminClient
      .from(table)
      .update({
        [column]: newValue,
        ...(isManualFteEdit ? { fte_is_manual_override: true } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", entityId);

    if (updateError) {
      console.error(`Error updating ${table}.${column}:`, updateError);
      return { success: false, error: "Failed to update field" };
    }

    // 5. Post-write side effects
    if (table === "contacts") {
      const { data: updatedContact, error: updatedContactError } = await supabase
        .from("contacts")
        .select("id, organization_id, name, work_email, email, role_title, work_phone_number, phone, archived_at")
        .eq("id", entityId)
        .maybeSingle();

      if (updatedContactError) {
        console.warn("[update-field] unable to load contact after update:", updatedContactError.message);
      } else if (updatedContact) {
        await syncContactIdentity(updatedContact as ContactIdentityRow);
      }
    }

    // 6. Passive FYI notification for Tier 2 fields on org pages
    if (isTier2(table, column) && isOrgPageEdit) {
      void sendContentChangeFyi({
        fieldLabel: fieldDisplayLabel(column),
        entityDisplayName: resolvedDisplayName,
        previousValue: previousValue !== null ? String(previousValue) : null,
        newValue: newValue !== null ? String(newValue) : null,
        changedByEmail: userEmail ?? "unknown",
        pageHref: pageHref ?? (resolvedOrgId ? `/org/${resolvedOrgId}` : null),
      }).catch((err) => {
        console.warn("[update-field] FYI email failed (non-blocking):", err);
      });
    }

    // 7. Bust Next.js server cache so router.refresh() sees the new value
    if (pageHref) {
      revalidatePath(pageHref);
    } else {
      // No specific path — revalidate everything (edits are infrequent admin ops)
      revalidatePath("/", "layout");
    }

    console.log(`[update-field] ${table}.${column} updated`, { entityId, previousValue, newValue, user: userEmail });

    return { success: true, previousValue };
  } catch (err) {
    console.error("Error updating field:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
