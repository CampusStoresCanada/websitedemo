import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";

/**
 * Per-account settings: `profiles.preferences`, one jsonb object per login.
 *
 * Per ACCOUNT, deliberately — not per contact. A contact is a person at one
 * organization; how someone likes their lists sorted travels with them.
 * See 20260825180000_profiles_preferences.
 *
 * ⛔ Every key is written through `writePreference`. Read-modify-write so the
 * other keys survive, and the admin client because a session client hits RLS
 * and reports a silent no-op.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** This account's preferences, or `{}` when unreadable — a setting never blocks a page. */
export async function readPreferences(userId: string): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await createAdminClient()
      .from("profiles")
      .select("preferences")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[profile/preferences] read failed:", error.message);
      return {};
    }
    return isRecord(data?.preferences) ? data.preferences : {};
  } catch (err) {
    console.warn("[profile/preferences] read threw:", err instanceof Error ? err.message : err);
    return {};
  }
}

/** Set one key, keeping the rest. False when the profile is unreadable or the write fails. */
export async function writePreference(userId: string, key: string, value: unknown): Promise<boolean> {
  const db = createAdminClient();
  const { data, error: readError } = await db
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .maybeSingle();
  if (readError || !data) {
    console.error(
      "[profile/preferences] write aborted, profile unreadable:",
      readError?.message ?? "no profile row"
    );
    return false;
  }

  const current = isRecord(data.preferences) ? data.preferences : {};
  const { error } = await db
    .from("profiles")
    .update({ preferences: { ...current, [key]: value } as Json })
    .eq("id", userId);
  if (error) {
    console.error("[profile/preferences] write failed:", error.message);
    return false;
  }
  return true;
}
