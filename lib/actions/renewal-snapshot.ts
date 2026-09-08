"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import { getBoardRenewalReport } from "@/lib/renewal/board-report";
import { saveRenewalSnapshot, approveRenewalSnapshot } from "@/lib/renewal/snapshot";

// NOTE: "use server" modules may only export async functions — a `const` here
// type-checks and then 500s every page that imports it.

export async function pullRenewalSnapshotAction(input: {
  meetingId: string;
  meetingDate: string;
  eventSlug?: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  // Recompute at pull time rather than trusting anything the client sent — the
  // whole value of the snapshot is that it is the server's own reading.
  const report = await getBoardRenewalReport(input.meetingDate);
  if (!report) {
    return { success: false, error: "This meeting is outside the renewal reporting window." };
  }

  const result = await saveRenewalSnapshot({
    meetingId: input.meetingId,
    report,
    pulledBy: auth.ctx.userId,
  });
  if (!result.success) return { success: false, error: result.error };

  if (input.eventSlug) revalidatePath(`/events/${input.eventSlug}`);
  return { success: true };
}

export async function approveRenewalSnapshotAction(input: {
  meetingId: string;
  eventSlug?: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const result = await approveRenewalSnapshot({
    meetingId: input.meetingId,
    approvedBy: auth.ctx.userId,
  });
  if (!result.success) return { success: false, error: result.error };

  if (input.eventSlug) revalidatePath(`/events/${input.eventSlug}`);
  return { success: true };
}
