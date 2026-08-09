import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Which conference is "the current one" for a friendly-URL redirect
 * (campusstores.events -> the live conference page). Prefers the soonest
 * upcoming/ongoing conference (draft through active); if every conference
 * is already completed (e.g. between one wrapping up and next year's being
 * created), falls back to the most recently completed one so the link
 * doesn't go dead in the gap. Archived conferences are never picked.
 */
export async function getCurrentConferencePath(): Promise<string | null> {
  const db = createAdminClient();

  const { data: upcoming } = await db
    .from("conference_instances")
    .select("year, edition_code")
    .neq("status", "archived")
    .neq("status", "completed")
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (upcoming) return `/conference/${upcoming.year}/${upcoming.edition_code}`;

  const { data: mostRecentlyCompleted } = await db
    .from("conference_instances")
    .select("year, edition_code")
    .eq("status", "completed")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (mostRecentlyCompleted) {
    return `/conference/${mostRecentlyCompleted.year}/${mostRecentlyCompleted.edition_code}`;
  }

  return null;
}
