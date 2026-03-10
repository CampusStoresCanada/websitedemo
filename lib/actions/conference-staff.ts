"use server";

import {
  requireAuthenticated,
  isGlobalAdmin,
} from "@/lib/auth/guards";
import { ensurePersonForUser, upsertConferenceContact } from "@/lib/identity/lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";
import { syncConferencePeopleIndex } from "@/lib/actions/conference-people";

type StaffRow = Database["public"]["Tables"]["conference_staff"]["Row"];
type StaffInsert = Database["public"]["Tables"]["conference_staff"]["Insert"];

async function checkAdditionalStaffEligibility(params: {
  conferenceId: string;
  organizationId: string;
  registrationType: string;
  accommodationType: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // First 2 staff are free; rules apply to additional staff add-ons only.
  if (!params.accommodationType || params.accommodationType === "none") {
    return { ok: true };
  }

  const productSlug =
    params.accommodationType === "full"
      ? "exhibitor_staff_accommodation"
      : "exhibitor_staff_meals_only";

  const adminClient = createAdminClient();
  const { data: product, error: productError } = await adminClient
    .from("conference_products")
    .select("id")
    .eq("conference_id", params.conferenceId)
    .eq("slug", productSlug)
    .maybeSingle();

  if (productError) {
    return { ok: false, error: productError.message };
  }
  if (!product) {
    return {
      ok: false,
      error: `Required conference product "${productSlug}" is missing.`,
    };
  }

  const { data: rules, error: rulesError } = await adminClient
    .from("conference_product_rules")
    .select("rule_type, rule_config, error_message")
    .eq("product_id", product.id);

  if (rulesError) {
    return { ok: false, error: rulesError.message };
  }

  for (const rule of rules ?? []) {
    if (rule.rule_type === "requires_org_type") {
      const requiredType = (rule.rule_config as { org_type?: string } | null)?.org_type;
      if (!requiredType) continue;

      const { data: org, error } = await adminClient
        .from("organizations")
        .select("type")
        .eq("id", params.organizationId)
        .maybeSingle();

      if (error) return { ok: false, error: error.message };
      if (!org || org.type !== requiredType) {
        return {
          ok: false,
          error: rule.error_message || "Organization type is not eligible for this add-on.",
        };
      }
    }

    if (rule.rule_type === "requires_registration") {
      const requiredType = (rule.rule_config as { registration_type?: string } | null)
        ?.registration_type;
      if (!requiredType) continue;
      if (params.registrationType !== requiredType) {
        return {
          ok: false,
          error:
            rule.error_message || "Required conference registration is missing for this add-on.",
        };
      }
    }

    if (rule.rule_type === "requires_product") {
      return {
        ok: false,
        error:
          "Product dependency checks require Chunk 12 commerce orders and are not available yet.",
      };
    }
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────
// Add staff member to an exhibitor registration
// ─────────────────────────────────────────────────────────────────

export async function addStaffMember(
  registrationId: string,
  data: Omit<
    StaffInsert,
    "id" | "created_at" | "registration_id" | "conference_id" | "organization_id"
  > & { person_id?: string | null }
): Promise<{ success: boolean; error?: string; data?: StaffRow }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Validate registration ownership
  const { data: reg, error: regErr } = await adminClient
    .from("conference_registrations")
    .select("user_id, conference_id, organization_id, registration_type")
    .eq("id", registrationId)
    .single();

  if (regErr || !reg) {
    return { success: false, error: "Registration not found" };
  }
  if (reg.user_id !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized" };
  }
  if (reg.registration_type !== "exhibitor") {
    return { success: false, error: "Staff can only be added to exhibitor registrations" };
  }

  const { count: existingStaffCount, error: countError } = await adminClient
    .from("conference_staff")
    .select("*", { count: "exact", head: true })
    .eq("registration_id", registrationId);

  if (countError) {
    return { success: false, error: countError.message };
  }

  if ((existingStaffCount ?? 0) >= 2) {
    const eligibility = await checkAdditionalStaffEligibility({
      conferenceId: reg.conference_id,
      organizationId: reg.organization_id,
      registrationType: reg.registration_type,
      accommodationType: data.accommodation_type ?? null,
    });
    if (!eligibility.ok) {
      return { success: false, error: eligibility.error };
    }
  }

  const { person_id: personId, ...staffData } = data;

  let resolvedUserId = staffData.user_id ?? null;
  if (personId) {
    const { data: linkedUser, error: linkedUserError } = await adminClient
      .from("users")
      .select("id")
      .eq("person_id", personId)
      .maybeSingle();
    if (linkedUserError) {
      return { success: false, error: linkedUserError.message };
    }
    resolvedUserId = linkedUser?.id ?? null;

    await upsertConferenceContact({
      organizationId: reg.organization_id,
      personId,
      name: staffData.name,
      email: staffData.email,
      phone: staffData.phone ?? undefined,
      contactType: ["conference", "staff"],
    });
  }

  if (resolvedUserId) {
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("id", resolvedUserId)
      .maybeSingle();
    if (profileError) {
      return { success: false, error: profileError.message };
    }
    if (!profile) {
      resolvedUserId = null;
    }
  }

  if (resolvedUserId) {
    await ensurePersonForUser({
      userId: resolvedUserId,
      organizationId: reg.organization_id,
      fallbackEmail: staffData.email ?? null,
    });
  }

  const { data: staff, error } = await adminClient
    .from("conference_staff")
    .insert({
      ...staffData,
      user_id: resolvedUserId,
      registration_id: registrationId,
      conference_id: reg.conference_id,
      organization_id: reg.organization_id,
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };

  await syncConferencePeopleIndex(reg.conference_id).catch((syncError) => {
    console.warn("[conference-staff] syncConferencePeopleIndex(add) failed", {
      conferenceId: reg.conference_id,
      error: syncError instanceof Error ? syncError.message : String(syncError),
    });
  });

  return { success: true, data: staff };
}

// ─────────────────────────────────────────────────────────────────
// Remove staff member
// ─────────────────────────────────────────────────────────────────

export async function removeStaffMember(
  staffId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Validate ownership via parent registration
  const { data: staff, error: staffErr } = await adminClient
    .from("conference_staff")
    .select("registration_id")
    .eq("id", staffId)
    .single();

  if (staffErr || !staff) {
    return { success: false, error: "Staff member not found" };
  }

  const { data: reg } = await adminClient
    .from("conference_registrations")
    .select("user_id, conference_id")
    .eq("id", staff.registration_id)
    .single();

  if (!reg) {
    return { success: false, error: "Parent registration not found" };
  }
  if (reg.user_id !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized" };
  }

  const { error } = await adminClient
    .from("conference_staff")
    .delete()
    .eq("id", staffId);

  if (error) return { success: false, error: error.message };

  await syncConferencePeopleIndex(reg.conference_id).catch((syncError) => {
    console.warn("[conference-staff] syncConferencePeopleIndex(remove) failed", {
      conferenceId: reg.conference_id,
      error: syncError instanceof Error ? syncError.message : String(syncError),
    });
  });

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────
// Get staff for a registration
// ─────────────────────────────────────────────────────────────────

export async function getStaffForRegistration(
  registrationId: string
): Promise<{ success: boolean; error?: string; data?: StaffRow[] }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const adminClient = createAdminClient();

  // Validate ownership
  const { data: reg, error: regErr } = await adminClient
    .from("conference_registrations")
    .select("user_id")
    .eq("id", registrationId)
    .single();

  if (regErr || !reg) {
    return { success: false, error: "Registration not found" };
  }
  if (reg.user_id !== auth.ctx.userId && !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not authorized" };
  }

  const { data, error } = await adminClient
    .from("conference_staff")
    .select("*")
    .eq("registration_id", registrationId)
    .order("created_at", { ascending: true });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data ?? [] };
}
