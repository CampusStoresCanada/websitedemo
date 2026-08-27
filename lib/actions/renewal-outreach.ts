"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/guards";
import {
  logRenewalContact,
  setRenewalAssignment,
  type ContactChannel,
  type ContactOutcome,
} from "@/lib/renewal/outreach";

// NOTE: "use server" modules may only export async functions. The channel and
// outcome constants live in lib/renewal/outreach.ts and are imported by the
// client component directly — exporting them from here would type-check and
// then break every page that imports this module at runtime.

export async function logRenewalContactAction(input: {
  organizationId: string;
  renewalYear: number;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note: string | null;
  eventSlug?: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const result = await logRenewalContact({
    organizationId: input.organizationId,
    renewalYear: input.renewalYear,
    contactedBy: auth.ctx.userId,
    channel: input.channel,
    outcome: input.outcome,
    note: input.note,
  });
  if (!result.success) return { success: false, error: result.error };

  // Without this the board tab keeps serving the cached page and the entry the
  // user just made appears not to have saved — the failure mode that made
  // "Send Now" look idempotent when it was not.
  if (input.eventSlug) revalidatePath(`/events/${input.eventSlug}`);
  revalidatePath("/admin");
  return { success: true };
}

export async function setRenewalAssignmentAction(input: {
  organizationId: string;
  renewalYear: number;
  assignedTo: string | null;
  eventSlug?: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const result = await setRenewalAssignment({
    organizationId: input.organizationId,
    renewalYear: input.renewalYear,
    assignedTo: input.assignedTo,
    assignedBy: auth.ctx.userId,
  });
  if (!result.success) return { success: false, error: result.error };

  if (input.eventSlug) revalidatePath(`/events/${input.eventSlug}`);
  revalidatePath("/admin");
  return { success: true };
}
