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
