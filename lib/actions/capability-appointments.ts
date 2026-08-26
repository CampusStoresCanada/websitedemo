"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * Appointing someone to a capability, for a term.
 *
 * These used to write `capability_grants`: a row saying "this person holds this
 * capability until this date". Nothing ever resolved against that table.
 * has_capability(), current_capabilities() and capability_contributions all
 * derive from governance_role_assignments joined to governance_role_capabilities
 * — so an admin could appoint someone, see a success message, and change
 * nothing at all. That is worse than a missing feature, because it is a control
 * that reports it worked.
 *
 * They now write a role assignment, which is the thing that governs. The shape
 * a person cares about is unchanged — who, which capability, until when, and
 * why — but the capability is reached through the role that carries it:
 *
 *   capability  →  the appointable role_key that grants it  →  an assignment
 *
 * `appointable` is what distinguishes those roles from offices. `secretary`
 * carries four benchmarking capabilities ex officio; you do not appoint someone
 * to secretary in order to let them review questions, so it is not appointable
 * and never appears as a target here.
 *
 * The term is the expiry. `capability_grants.ends_at` existed to make access
 * temporary; `term_end` does the same job in the table that is actually read,
 * and `appointing_resolution` records why — which the grants table never
 * captured in a form anyone would find later.
 */

export interface AppointmentResult {
  success: boolean;
  error?: string;
}

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };
  if (!isGlobalAdmin(auth.ctx.globalRole)) {
    return { ok: false, error: "Administrator access required" };
  }
  return { ok: true, userId: auth.ctx.userId };
}

/** The role to appoint someone to in order to give them this capability. */
async function appointableRoleFor(capability: string): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("governance_role_capabilities")
    .select("role_key")
    .eq("capability", capability)
    .eq("appointable", true)
    .limit(1)
    .maybeSingle();
  return (data?.role_key as string) ?? null;
}

/**
 * Give someone a capability until a date.
 *
 * Refuses rather than guesses when no appointable role carries the capability.
 * Silently inventing a role, or falling back to an ex-officio one, would make
 * somebody the secretary because they were asked to check some questions.
 */
export async function appointToCapability(input: {
  subjectId: string;
  capability: string;
  reason: string;
  endsAt: string;
  bodyKey?: string;
}): Promise<AppointmentResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  if (!input.reason?.trim()) {
    // The reason is the whole audit trail. An appointment nobody can explain
    // later is one nobody can defend later.
    return { success: false, error: "Say why this person is being appointed." };
  }

  const roleKey = await appointableRoleFor(input.capability);
  if (!roleKey) {
    return {
      success: false,
      error: `No appointable role carries "${input.capability}". It may be held ex officio only.`,
    };
  }

  const db = createAdminClient();

  const { data: body } = await db
    .from("governance_bodies")
    .select("id")
    .eq("key", input.bodyKey ?? "benchmarking_committee")
    .maybeSingle();

  if (!body?.id) {
    return { success: false, error: "That governance body does not exist yet." };
  }

  // Already holds it, by any route? Appointing again would produce a second
  // active row that says the same thing and expires on a different day.
  const { data: existing } = await db
    .from("capability_contributions")
    .select("assignment_id")
    .eq("subject_id", input.subjectId)
    .eq("capability", input.capability)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (existing?.assignment_id) {
    return { success: false, error: "They already hold this capability." };
  }

  const { error } = await db.from("governance_role_assignments").insert({
    body_id: body.id,
    person_profile_id: input.subjectId,
    role_key: roleKey,
    term_start: new Date().toISOString().slice(0, 10),
    term_end: input.endsAt.slice(0, 10),
    appointing_resolution: input.reason.trim(),
    // A committee appointment is not a board seat and must not count against
    // the by-law cap on directors.
    counts_toward_cap: false,
  });

  if (error) {
    console.error("[appointToCapability]", error);
    return { success: false, error: "Could not save that appointment." };
  }

  revalidatePath("/admin/access");
  return { success: true };
}

/**
 * End an appointment today.
 *
 * Ends the term rather than deleting the row: who held what, and when, is the
 * record. A deleted appointment cannot be distinguished from one that never
 * happened.
 */
export async function endAppointment(assignmentId: string): Promise<AppointmentResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  const db = createAdminClient();
  const { error } = await db
    .from("governance_role_assignments")
    .update({ term_end: new Date().toISOString().slice(0, 10) })
    .eq("id", assignmentId);

  if (error) {
    console.error("[endAppointment]", error);
    return { success: false, error: "Could not end that appointment." };
  }

  revalidatePath("/admin/access");
  return { success: true };
}

/** Push an appointment's end date out. */
export async function extendAppointment(
  assignmentId: string,
  endsAt: string,
): Promise<AppointmentResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  const db = createAdminClient();
  const { error } = await db
    .from("governance_role_assignments")
    .update({ term_end: endsAt.slice(0, 10) })
    .eq("id", assignmentId);

  if (error) {
    console.error("[extendAppointment]", error);
    return { success: false, error: "Could not extend that appointment." };
  }

  revalidatePath("/admin/access");
  return { success: true };
}

export interface PersonHit {
  id: string;
  name: string;
  email: string | null;
}

/** People who can be appointed — anyone with a login. */
export async function searchPeopleForAppointment(query: string): Promise<PersonHit[]> {
  const admin = await requireAdmin();
  if (!admin.ok) return [];

  const q = query.trim();
  if (q.length < 2) return [];

  const db = createAdminClient();
  const { data } = await db
    .from("profiles")
    .select("id, display_name")
    .ilike("display_name", `%${q}%`)
    .limit(10);

  return (data ?? []).map((p) => ({
    id: p.id as string,
    name: (p.display_name as string) ?? "Unknown",
    email: null,
  }));
}

/** Capabilities that can actually be appointed, for the picker. */
export async function appointableCapabilities(): Promise<
  { capability: string; roleKey: string }[]
> {
  const admin = await requireAdmin();
  if (!admin.ok) return [];

  const db = createAdminClient();
  const { data } = await db
    .from("governance_role_capabilities")
    .select("capability, role_key")
    .eq("appointable", true)
    .order("capability");

  return (data ?? []).map((r) => ({
    capability: r.capability as string,
    roleKey: r.role_key as string,
  }));
}
