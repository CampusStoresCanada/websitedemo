"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticated } from "@/lib/auth/guards";
import {
  canUsePresentationMode,
  type PresentationLevel,
} from "@/lib/presentation/mode";
import { setPresentationMode } from "@/lib/presentation/store";

/**
 * Turn presentation mode on at a given audience, or off with `null`.
 *
 * Authorised on `globalRole` like every other staff action — presentation mode
 * changes what the caller is SHOWN, never what they may do, so there is no
 * privilege here to escalate. `setPresentationMode` re-checks the role itself
 * rather than trusting this caller.
 *
 * Revalidates the layout root because the level is resolved server-side during
 * render: without this the next navigation would still paint the old audience,
 * which on a screen share is the one failure that matters.
 */
export async function updatePresentationMode(
  level: PresentationLevel | null,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "You must be logged in" };

  const { userId, globalRole } = auth.ctx;
  if (!canUsePresentationMode(globalRole)) {
    return { success: false, error: "Presentation mode is for CSC staff accounts" };
  }

  const ok = await setPresentationMode(userId, globalRole, level);
  if (!ok) return { success: false, error: "Could not save the setting" };

  revalidatePath("/", "layout");
  return { success: true };
}
