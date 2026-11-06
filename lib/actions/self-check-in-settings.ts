"use server";

/**
 * Reading and writing one conference's self check-in settings
 * (lib/conference/self-check-in.ts). Admins set them up, like the badge scan
 * rules beside them: desk staff operate a conference, they do not design it.
 */

import { revalidatePath } from "next/cache";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { normalizeSelfCheckIn, type SelfCheckInSettings } from "@/lib/conference/self-check-in";
import { loadSelfCheckInSettings } from "@/lib/conference/self-check-in-server";

export async function getSelfCheckInSettings(
  conferenceId: string
): Promise<{ ok: true; data: SelfCheckInSettings } | { ok: false; error: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { ok: false, error: auth.error };
  return { ok: true, data: await loadSelfCheckInSettings(conferenceId) };
}

export async function saveSelfCheckInSettings(
  conferenceId: string,
  settings: SelfCheckInSettings
): Promise<{ ok: true; data: SelfCheckInSettings } | { ok: false; error: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Normalised on the way in too: what is stored is exactly what is read.
  const clean = normalizeSelfCheckIn(settings);
  const { error } = await createAdminClient()
    .from("conference_instances")
    .update({ self_check_in: clean })
    .eq("id", conferenceId);
  if (error) return { ok: false, error: `Could not save self check-in: ${error.message}` };

  await logAuditEventSafe({
    action: "conference_self_check_in_settings_saved",
    entityType: "conference_instances",
    entityId: conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: { ...clean },
  });
  revalidatePath(`/admin/conference/${conferenceId}/badges`);
  revalidatePath(`/admin/conference/${conferenceId}/check-in`);
  return { ok: true, data: clean };
}
