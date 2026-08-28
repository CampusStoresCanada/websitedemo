"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { syncRenewalActionItems } from "@/lib/renewal/action-items";

export async function syncRenewalActionItemsAction(input: {
  meetingId: string;
  renewalYear: number;
  eventSlug?: string;
}): Promise<{ success: boolean; error?: string; created?: number; updated?: number; closed?: number }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  try {
    const r = await syncRenewalActionItems({
      meetingId: input.meetingId,
      renewalYear: input.renewalYear,
    });
    if (input.eventSlug) revalidatePath(`/events/${input.eventSlug}`);
    revalidatePath("/admin/renewals");
    return { success: true, ...r };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Sync failed" };
  }
}
