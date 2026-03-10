"use server";

import {
  canManageOrganization,
  requireAuthenticated,
} from "@/lib/auth/guards";
import { ensureKnownPerson, upsertPersonContact } from "@/lib/identity/lifecycle";

/**
 * Security allowlist of editable columns per table.
 * Only these columns can be updated via the Edit tool.
 */
const EDITABLE_COLUMNS: Record<string, string[]> = {
  organizations: [
    "company_description",
    "website",
    "email",
    "phone",
    "square_footage",
    "fte",
    "logo_url",
    "logo_horizontal_url",
    "hero_image_url",
    "product_overlay_url",
    "action_link_text",
    "action_link_url",
    "primary_category",
  ],
  contacts: [
    "name",
    "work_email",
    "email",
    "role_title",
    "work_phone_number",
    "phone",
  ],
  brand_colors: [
    "hex",
    "name",
  ],
  benchmarking: [
    "enrollment_fte",
    "num_store_locations",
    "institution_type",
    "pos_system",
    "total_square_footage",
    "fulltime_employees",
  ],
};

interface UpdateFieldParams {
  table: "organizations" | "contacts" | "brand_colors" | "benchmarking";
  column: string;
  entityId: string;
  newValue: string | number | null;
}

interface UpdateFieldResult {
  success: boolean;
  error?: string;
  previousValue?: string | number | null;
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
 * - Only allowlisted columns can be updated
 * - Entity ownership is verified
 */
export async function updateField({
  table,
  column,
  entityId,
  newValue,
}: UpdateFieldParams): Promise<UpdateFieldResult> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { success: false, error: "You must be logged in to edit" };
    }
    const { supabase, userEmail } = auth.ctx;

    // 3. Validate column is in allowlist
    const allowedColumns = EDITABLE_COLUMNS[table];
    if (!allowedColumns || !allowedColumns.includes(column)) {
      console.error(`Column ${table}.${column} is not editable`);
      return { success: false, error: "This field cannot be edited" };
    }

    // 4. Verify entity ownership and get previous value
    let canEdit = false;
    let previousValue: string | number | null = null;

    if (table === "organizations") {
      const { data: org } = await supabase
        .from("organizations")
        .select("id, " + column)
        .eq("id", entityId)
        .single();

      if (!org) {
        return { success: false, error: "Organization not found" };
      }

      const orgData = org as unknown as Record<string, unknown>;
      previousValue = orgData[column] as string | number | null;
      canEdit = canManageOrganization(auth.ctx, entityId);
    } else if (table === "contacts") {
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, organization_id, " + column)
        .eq("id", entityId)
        .single();

      if (!contact) {
        return { success: false, error: "Contact not found" };
      }

      const contactData = contact as unknown as Record<string, unknown>;
      previousValue = contactData[column] as string | number | null;
      const orgId = contactData.organization_id as string | null;
      canEdit = Boolean(orgId && canManageOrganization(auth.ctx, orgId));
    } else if (table === "brand_colors") {
      const { data: color } = await supabase
        .from("brand_colors")
        .select("id, organization_id, " + column)
        .eq("id", entityId)
        .single();

      if (!color) {
        return { success: false, error: "Brand color not found" };
      }

      const colorData = color as unknown as Record<string, unknown>;
      previousValue = colorData[column] as string | number | null;
      const orgId = colorData.organization_id as string;
      canEdit = canManageOrganization(auth.ctx, orgId);
    } else if (table === "benchmarking") {
      const { data: benchmark } = await supabase
        .from("benchmarking")
        .select("id, organization_id, " + column)
        .eq("id", entityId)
        .single();

      if (!benchmark) {
        return { success: false, error: "Benchmarking record not found" };
      }

      const benchmarkData = benchmark as unknown as Record<string, unknown>;
      previousValue = benchmarkData[column] as string | number | null;
      const orgId = benchmarkData.organization_id as string;
      canEdit = canManageOrganization(auth.ctx, orgId);
    }

    if (!canEdit) {
      return { success: false, error: "You don't have permission to edit this" };
    }

    // 5. Perform the update
    const updateData = {
      [column]: newValue,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from(table)
      .update(updateData)
      .eq("id", entityId);

    if (updateError) {
      console.error(`Error updating ${table}.${column}:`, updateError);
      return { success: false, error: "Failed to update field" };
    }

    if (table === "contacts") {
      const { data: updatedContact, error: updatedContactError } = await supabase
        .from("contacts")
        .select(
          "id, organization_id, name, work_email, email, role_title, work_phone_number, phone, archived_at"
        )
        .eq("id", entityId)
        .maybeSingle();

      if (updatedContactError) {
        console.warn(
          "[update-field] unable to load contact after update for identity sync:",
          updatedContactError.message
        );
      } else if (updatedContact) {
        await syncContactIdentity(updatedContact as ContactIdentityRow);
      }
    }

    // Log for debugging
    console.log("=== FIELD UPDATED ===");
    console.log("Table:", table);
    console.log("Column:", column);
    console.log("Entity ID:", entityId);
    console.log("Previous:", previousValue);
    console.log("New:", newValue);
    console.log("User:", userEmail);
    console.log("=====================");

    return { success: true, previousValue };
  } catch (err) {
    console.error("Error updating field:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
