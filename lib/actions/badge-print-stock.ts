"use server";

/**
 * Reading and writing one conference's blank-stock policy.
 *
 * ⛔ The percentages are shown WITH THE NUMBERS THEY RESOLVE TO, computed from
 * the same function the printer uses. "20%" on its own is not a decision an
 * operator can check — 20% of the exhibitor basis is 48 cards and 20% of a
 * 13-person member roster is 3, which is why the floor exists, and no amount of
 * staring at "20" tells you that. Showing the arithmetic is the point.
 *
 * ⚠️ Costs a full badge run (~800ms), because the member roster is "people
 * named as the run stands now". Fine for a settings screen loaded on purpose;
 * not something to poll.
 */

import { revalidatePath } from "next/cache";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveBadgeRun } from "@/lib/conference/badges/run";
import {
  computeSpareCounts,
  loadSpareBasis,
  normalizeBadgePrintStock,
  type BadgePrintStock,
  type SpareCounts,
} from "@/lib/conference/badges/print-stock";

export type BadgePrintStockOptions = {
  stock: BadgePrintStock;
  /** What the saved percentages come to against live numbers, right now. */
  preview: SpareCounts;
};

export async function loadBadgePrintStockOptions(
  conferenceId: string
): Promise<{ ok: true; data: BadgePrintStockOptions } | { ok: false; error: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = createAdminClient();
  const [confRes, run] = await Promise.all([
    db.from("conference_instances").select("badge_print_stock").eq("id", conferenceId).maybeSingle(),
    resolveBadgeRun(conferenceId),
  ]);

  const stock = normalizeBadgePrintStock(confRes.data?.badge_print_stock);
  const basis = await loadSpareBasis(db, conferenceId, run);
  return { ok: true, data: { stock, preview: computeSpareCounts({ stock, ...basis }) } };
}

/**
 * Recompute the preview as the operator types.
 *
 * ⛔ Takes the BASIS the client already has and does no database work — the
 * arithmetic is the only thing that changes when a percentage does. Re-running a
 * badge run per keystroke would cost ~800ms a character; recomputing in the
 * component would put a second copy of the formula in the UI, which is how a
 * screen ends up confidently showing a number the printer disagrees with.
 */
export async function previewBadgePrintStock(
  stock: BadgePrintStock,
  basis: SpareCounts["basis"]
): Promise<{ ok: true; preview: SpareCounts } | { ok: false; error: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { ok: false, error: auth.error };
  return {
    ok: true,
    preview: computeSpareCounts({
      stock: normalizeBadgePrintStock(stock),
      possibleExhibitorSeats: basis.possibleExhibitorSeats,
      soldExhibitorSeats: basis.soldExhibitorSeats,
      memberRoster: basis.memberRoster,
    }),
  };
}

export async function saveBadgePrintStock(
  conferenceId: string,
  stock: BadgePrintStock
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Normalised on the way in as well as out: a percentage above 100 or a
  // negative floor is a typo, and this decides how many physical cards a
  // conference pays to print.
  const clean = normalizeBadgePrintStock(stock);
  const { error } = await createAdminClient()
    .from("conference_instances")
    .update({ badge_print_stock: clean })
    .eq("id", conferenceId);
  if (error) return { ok: false, error: `Could not save the stock policy: ${error.message}` };

  revalidatePath(`/admin/conference/${conferenceId}/badges`);
  return { ok: true };
}
