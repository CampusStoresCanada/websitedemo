import { createAdminClient } from "@/lib/supabase/admin";
import type { GlobalRole } from "@/lib/auth/types";
import {
  canUsePresentationMode,
  isRecord,
  PREFERENCE_KEY,
  type PresentationLevel,
} from "./mode";

/**
 * The write half of presentation mode, kept apart from ./mode.ts because that
 * module is imported by client components for its labels and types. Importing
 * `createAdminClient` there would bundle the service-role client into the
 * browser — lib/supabase/admin.ts carries no `server-only` guard to stop it.
 */

/**
 * Persist the level for this account, or clear it with `null`.
 *
 * Read-modify-write so unrelated preference keys survive, and the admin client
 * because a session client hits RLS and reports a silent no-op — the same
 * trap lib/circle/badge-preference.ts documents.
 */
export async function setPresentationMode(
  userId: string,
  role: GlobalRole,
  level: PresentationLevel | null,
): Promise<boolean> {
  if (!canUsePresentationMode(role)) return false;

  const db = createAdminClient();
  const { data, error: readError } = await db
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .maybeSingle();

  if (readError || !data) {
    console.error(
      "[presentation/mode] write aborted, profile unreadable:",
      readError?.message ?? "no profile row",
    );
    return false;
  }

  const current = isRecord(data.preferences) ? { ...data.preferences } : {};
  if (level === null) {
    delete current[PREFERENCE_KEY];
  } else {
    current[PREFERENCE_KEY] = level;
  }

  const { error } = await db
    .from("profiles")
    .update({ preferences: current })
    .eq("id", userId);

  if (error) {
    console.error("[presentation/mode] write failed:", error.message);
    return false;
  }

  return true;
}
