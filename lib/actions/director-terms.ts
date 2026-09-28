"use server";

/**
 * Recording what the association already knows about who has served.
 *
 * The term-limit check refuses to guess: countConsecutiveTerms returns null
 * when a person has no recorded history, and a nomination then reports that the
 * limit "cannot be checked" rather than quietly passing. That is the right
 * behaviour, and it left the Executive Director looking at a flag with nothing
 * to press — the history exists, on paper, with no way into the system.
 *
 * ⛔ This is a control for a human to enter a declared fact, never a place to
 * infer one. Nothing here derives a term from an election result or from a
 * name appearing on an old slate. Who served, for how long, and whether a
 * mid-term appointment counts against the cap are all judgements the board
 * made; the software records them and does not reconstruct them.
 *
 * ⚠️ `term_end` is EXCLUSIVE. A two-year term beginning 2026-01-01 ends
 * 2028-01-01, not 2027-12-31, and the existing 19 rows are written that way.
 * The editor says so out loud, because an off-by-one here silently changes
 * whether somebody has reached the four-term limit.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

export interface TermResult {
  success: boolean;
  error?: string;
}

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };
  if (!isGlobalAdmin(auth.ctx.globalRole))
    return { ok: false, error: "Administrator access required" };
  return { ok: true, userId: auth.ctx.userId };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function addDirectorTerm(input: {
  bodyId: string;
  personContactId: string;
  personProfileId: string | null;
  organizationId: string | null;
  termStart: string;
  termEnd: string;
  countsTowardCap: boolean;
  notes: string;
  revalidate?: string;
}): Promise<TermResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  if (!ISO.test(input.termStart) || !ISO.test(input.termEnd))
    return { success: false, error: "Both dates are needed, as YYYY-MM-DD." };
  if (input.termEnd <= input.termStart)
    return {
      success: false,
      error:
        "The end date must be after the start. It is exclusive, so a term running through 2027 ends 2028-01-01.",
    };

  const db = createAdminClient();
  const { error } = await db.from("governance_role_assignments").insert({
    body_id: input.bodyId,
    person_contact_id: input.personContactId,
    person_profile_id: input.personProfileId,
    organization_id: input.organizationId,
    role_key: "director",
    term_start: input.termStart,
    term_end: input.termEnd,
    counts_toward_cap: input.countsTowardCap,
    notes: input.notes.trim() || null,
  });
  if (error) return { success: false, error: error.message };

  if (input.revalidate) revalidatePath(input.revalidate);
  return { success: true };
}

/**
 * "We checked, and they have not served before."
 *
 * A zero-length row that does not count toward the cap, which is the shape
 * countConsecutiveTerms was written to expect — its own docstring calls for
 * "an explicit zero-length history row set by the admin UI, not an absence".
 * With it the count reads 0 instead of null, and a first-time nominee stops
 * being unverifiable.
 */
export async function recordNoPriorService(input: {
  bodyId: string;
  personContactId: string;
  personProfileId: string | null;
  asOf: string;
  notes: string;
  revalidate?: string;
}): Promise<TermResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  if (!ISO.test(input.asOf)) return { success: false, error: "A date is needed." };

  const db = createAdminClient();
  const { error } = await db.from("governance_role_assignments").insert({
    body_id: input.bodyId,
    person_contact_id: input.personContactId,
    person_profile_id: input.personProfileId,
    role_key: "director",
    term_start: input.asOf,
    term_end: input.asOf,
    counts_toward_cap: false,
    notes: input.notes.trim() || "No prior service on this body, checked when recorded.",
  });
  if (error) return { success: false, error: error.message };

  if (input.revalidate) revalidatePath(input.revalidate);
  return { success: true };
}

/**
 * Remove a row entered in error.
 *
 * ⛔ Scoped to `role_key = 'director'` on the id, so this control can never
 * delete an office or a committee appointment that happens to share a table.
 */
export async function removeDirectorTerm(input: {
  assignmentId: string;
  revalidate?: string;
}): Promise<TermResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  const db = createAdminClient();
  const { error } = await db
    .from("governance_role_assignments")
    .delete()
    .eq("id", input.assignmentId)
    .eq("role_key", "director");
  if (error) return { success: false, error: error.message };

  if (input.revalidate) revalidatePath(input.revalidate);
  return { success: true };
}
