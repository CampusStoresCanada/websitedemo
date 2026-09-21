"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticated, requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { completeOnboardingStep, derivePersona } from "@/lib/actions/onboarding";
import type { ProcurementInfo } from "@/lib/types/procurement";
import type { Json } from "@/lib/database.types";

export async function updateProcurementInfo(
  organizationId: string,
  procurementInfo: ProcurementInfo
): Promise<{ success: boolean; error?: string }> {
  try {
    // Org admins and super admins can update anything.
    // Regular members can also update procurement info for their own org
    // (e.g. setting their buying category assignments in the Procurement tab).
    const adminAuth = await requireOrgAdminOrSuperAdmin(organizationId);
    if (!adminAuth.ok) {
      // Fall back: check if the user is an active member of this org
      const memberAuth = await requireAuthenticated();
      if (!memberAuth.ok) return { success: false, error: memberAuth.error };
      const db = createAdminClient();
      const { data: membership } = await db
        .from("user_organizations")
        .select("id")
        .eq("user_id", memberAuth.ctx.userId)
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .maybeSingle();
      if (!membership) return { success: false, error: "Not a member of this organization" };
    }
    // Service-role client, not auth.ctx.supabase: 20260723210000 dropped the
    // open UPDATE policy on organizations and left `authenticated` with the
    // GRANT but no policy, so every session-client write here matched zero
    // rows under RLS and still reported success — the save silently did
    // nothing. Authorization is enforced above, same as add/delete-brand-color.
    const supabase = createAdminClient();

    // Update the organization's procurement_info field
    const { error } = await supabase
      .from("organizations")
      .update({
        procurement_info: procurementInfo as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", organizationId);

    if (error) {
      console.error("Error updating procurement info:", error);
      return { success: false, error: error.message };
    }

    // Close the buyer's onboarding step, if this save actually made them one.
    //
    // The `procurement` step used to complete on the CTA click — somebody
    // could open /me, set nothing, and the step would close with their
    // supplier panel still empty and no reminder coming. The org-level
    // completionTrigger is no better for a buyer: it fires the moment ANYONE
    // at their store saves procurement.
    //
    // It also cannot be done in the UI. OrgOnboardingCallout completes a step
    // by listening for a `csc:field-updated` DOM event, and that component is
    // mounted on the org page while a buyer edits procurement on /me. No event
    // it dispatches can reach a listener that isn't there. So the completion
    // belongs here, beside the write, where the question "is this person now a
    // named buyer" can actually be answered.
    await completeProcurementStepIfNamedBuyer(organizationId, procurementInfo);

    // Bust the route cache so the saved category selections render without
    // a manual refresh.
    revalidatePath("/", "layout");

    return { success: true };
  } catch (err) {
    console.error("Unexpected error updating procurement info:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Mark the `procurement` onboarding step done for the caller, but only when
 * they are actually named against a category after this save.
 *
 * Per-person on purpose: `category_buyers[].contact_ids` is the record of who
 * owns what, and it is the same field `getMemberSupplierData` reads to build
 * somebody's personal supplier list. If they are not in it, their panel is
 * empty and the step is not done, whatever they clicked on the way here.
 *
 * Never throws into the save path. A missed step close is a nudge that arrives
 * once more; a thrown error would lose procurement data the person just typed.
 */
async function completeProcurementStepIfNamedBuyer(
  organizationId: string,
  info: ProcurementInfo
): Promise<void> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) return;

    const db = createAdminClient();
    // Every contact row this person has at this org, not one. 39 people hold
    // two rows at a single org, so maybeSingle() throws for them — and the
    // catch below would swallow it, leaving their step open forever. Either
    // row could be the one named against a category; matching any of them is
    // both safe and correct. Not a reason to merge the rows: a duplicate is a
    // question for a human, never something to resolve silently here.
    const { data: contacts } = await db
      .from("contacts")
      .select("id")
      .eq("profile_id", auth.ctx.userId)
      .eq("organization_id", organizationId)
      .is("archived_at", null);

    const mine = new Set(((contacts ?? []) as { id: string }[]).map((c) => c.id));
    if (mine.size === 0) return;

    const named = (info.category_buyers ?? []).some((entry) =>
      (entry.contact_ids ?? []).some((id) => mine.has(id))
    );
    if (!named) return;

    const persona = await derivePersona();
    if (!persona) return;
    await completeOnboardingStep("procurement" as never, persona);
  } catch (err) {
    console.warn("[procurement] could not close the onboarding step:", err);
  }
}
