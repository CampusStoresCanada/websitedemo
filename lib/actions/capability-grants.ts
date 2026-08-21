"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * Granting and revoking time-boxed capabilities.
 *
 * Only admins grant. Every grant needs an end date and a reason — the schema
 * enforces both, and the reason is what makes the AGM report readable.
 */

async function verifyAdmin(): Promise<{
  ok: boolean;
  userId?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };
  if (!isGlobalAdmin(auth.ctx.globalRole)) {
    return { ok: false, error: "Admin access required" };
  }
  return { ok: true, userId: auth.ctx.userId };
}

/**
 * Issue a grant. Admins may issue anything; a delegate may issue only the
 * capabilities their own grant delegates, and never past their own end date.
 */
export async function grantCapability(input: {
  subjectId: string;
  capability: string;
  reason: string;
  endsAt: string;
  scopeType?: string | null;
  scopeId?: string | null;
  canDelegate?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const authed = await requireAuthenticated();
  if (!authed.ok) return { success: false, error: "Not signed in" };
  const actorId = authed.ctx.userId;
  const actorIsAdmin = isGlobalAdmin(authed.ctx.globalRole);

  const db0 = createAdminClient();

  // Non-admins must hold a delegating grant that covers this capability.
  let ceiling: Date | null = null;
  if (!actorIsAdmin) {
    const { data: until, error: ceilErr } = await db0.rpc(
      "max_delegable_until",
      { p_subject: actorId, p_child_capability: input.capability },
    );
    if (ceilErr) {
      console.error("[capability-grants] delegation check failed:", ceilErr);
      return { success: false, error: "Could not verify your authority" };
    }
    if (!until) {
      return {
        success: false,
        error: "You cannot hand out that capability",
      };
    }
    ceiling = new Date(until as string);
  }

  // Only an admin can mint another delegate.
  if (input.canDelegate && !actorIsAdmin) {
    return {
      success: false,
      error: "Only an admin can give someone the ability to delegate",
    };
  }

  const auth = { ok: true as const, userId: actorId };

  const reason = input.reason?.trim();
  if (!reason) {
    return {
      success: false,
      error: "Give a reason — it is what appears in the contributions report",
    };
  }

  const ends = new Date(input.endsAt);
  if (Number.isNaN(ends.getTime())) {
    return { success: false, error: "That end date is not a date" };
  }
  if (ends <= new Date()) {
    return { success: false, error: "The end date has already passed" };
  }
  if (ceiling && ends > ceiling) {
    return {
      success: false,
      error: `Your own access ends ${ceiling.toLocaleDateString("en-CA")} — you cannot grant past that`,
    };
  }

  const db = createAdminClient();
  const { error } = await db.from("capability_grants").insert({
    subject_id: input.subjectId,
    capability: input.capability,
    reason,
    ends_at: ends.toISOString(),
    scope_type: input.scopeType ?? null,
    scope_id: input.scopeId ?? null,
    granted_by: auth.userId,
    can_delegate: input.canDelegate === true,
  });

  if (error) {
    console.error("[capability-grants] grant failed:", error);
    return { success: false, error: "Could not create the grant" };
  }

  revalidatePath("/admin/access");
  revalidatePath("/benchmarking/admin");
  revalidatePath("/benchmarking/committee");
  return { success: true };
}

/**
 * Revoking ends a grant early. It does NOT delete the row — the person still
 * did the work, and the contributions report should still say so.
 */
export async function revokeCapability(
  grantId: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdmin();
  if (!auth.ok || !auth.userId) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await db
    .from("capability_grants")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: auth.userId,
      revoked_reason: reason?.trim() || null,
    })
    .eq("id", grantId)
    .is("revoked_at", null);

  if (error) {
    console.error("[capability-grants] revoke failed:", error);
    return { success: false, error: "Could not revoke" };
  }

  revalidatePath("/admin/access");
  revalidatePath("/benchmarking/admin");
  return { success: true };
}

/** Push an active grant's end date out, e.g. when a review window slips. */
export async function extendCapability(
  grantId: string,
  newEndsAt: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await verifyAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const ends = new Date(newEndsAt);
  if (Number.isNaN(ends.getTime()) || ends <= new Date()) {
    return { success: false, error: "Give a future end date" };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("capability_grants")
    .update({ ends_at: ends.toISOString() })
    .eq("id", grantId)
    .is("revoked_at", null);

  if (error) {
    console.error("[capability-grants] extend failed:", error);
    return { success: false, error: "Could not extend" };
  }

  revalidatePath("/admin/access");
  return { success: true };
}

/** Name search for the grant form. Admins only — it returns profile IDs. */
export async function searchPeopleForGrant(query: string): Promise<{
  success: boolean;
  people?: { id: string; name: string; globalRole: string }[];
  error?: string;
}> {
  const auth = await verifyAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const q = query?.trim();
  if (!q || q.length < 2) {
    return { success: false, error: "Type at least two characters" };
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("profiles")
    .select("id, display_name, global_role")
    .ilike("display_name", `%${q}%`)
    .order("display_name")
    .limit(10);

  if (error) {
    console.error("[capability-grants] search failed:", error);
    return { success: false, error: "Search failed" };
  }

  return {
    success: true,
    people: (data ?? []).map((p) => ({
      id: p.id,
      name: p.display_name ?? "Unknown",
      globalRole: p.global_role,
    })),
  };
}
