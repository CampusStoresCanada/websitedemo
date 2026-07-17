"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

/**
 * Conference v2 Stage 1 catalog — DAYS only (the time spine). The other nouns
 * (events / meals / education / sponsorships) are now faceted elements, managed
 * by lib/actions/conference-elements.ts. See docs/CONFERENCE_V2_BLUEPRINT.md §6c.
 */

type Tables = Database["public"]["Tables"];

export type ConferenceDayRow = Tables["conference_days"]["Row"];

type Result<T> = { success: true; data: T } | { success: false; error: string };

export type ConferenceCatalog = {
  days: ConferenceDayRow[];
};

const DAY_PROFILES = ["full_day", "half_day", "travel", "other"] as const;
export type ConferenceDayProfile = (typeof DAY_PROFILES)[number];

// ─────────────────────────────────────────────────────────────────
// Read: the whole catalog in one call
// ─────────────────────────────────────────────────────────────────

export async function getConferenceCatalog(
  conferenceId: string
): Promise<Result<ConferenceCatalog>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: days, error } = await db
    .from("conference_days")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("date");
  if (error) return { success: false, error: error.message };

  return { success: true, data: { days: days ?? [] } };
}

// ─────────────────────────────────────────────────────────────────
// Days
// ─────────────────────────────────────────────────────────────────

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Sync conference_days to the instance's start/end dates: create missing
 * days (default full_day) and renumber sort by date. Days that fall outside
 * the current range are NOT deleted (meal services hang off them); they are
 * returned as orphans for the admin to resolve explicitly.
 */
export async function ensureConferenceDays(
  conferenceId: string
): Promise<Result<{ days: ConferenceDayRow[]; created: number; orphanedDates: string[] }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: conference, error: confError } = await db
    .from("conference_instances")
    .select("start_date, end_date")
    .eq("id", conferenceId)
    .single();

  if (confError || !conference) {
    return { success: false, error: confError?.message ?? "Conference not found" };
  }
  if (!conference.start_date || !conference.end_date) {
    return { success: false, error: "Set conference start and end dates first." };
  }
  if (conference.end_date < conference.start_date) {
    return { success: false, error: "Conference end date is before its start date." };
  }

  const wantedDates = enumerateDates(conference.start_date, conference.end_date);

  const { data: existing, error: existingError } = await db
    .from("conference_days")
    .select("*")
    .eq("conference_id", conferenceId);
  if (existingError) return { success: false, error: existingError.message };

  const existingDates = new Set((existing ?? []).map((d) => d.date));
  const missing = wantedDates.filter((date) => !existingDates.has(date));

  if (missing.length > 0) {
    const { error: insertError } = await db.from("conference_days").insert(
      missing.map((date) => ({ conference_id: conferenceId, date }))
    );
    if (insertError) return { success: false, error: insertError.message };
  }

  // Renumber sort by date so in-range days are 0..n in calendar order.
  const { data: all, error: allError } = await db
    .from("conference_days")
    .select("*")
    .eq("conference_id", conferenceId)
    .order("date");
  if (allError || !all) return { success: false, error: allError?.message ?? "Reload failed" };

  const wantedSet = new Set(wantedDates);
  const inRange = all.filter((d) => wantedSet.has(d.date));
  for (const [index, day] of inRange.entries()) {
    if (day.sort !== index) {
      const { error: sortError } = await db
        .from("conference_days")
        .update({ sort: index, updated_at: new Date().toISOString() })
        .eq("id", day.id);
      if (sortError) return { success: false, error: sortError.message };
    }
  }

  return {
    success: true,
    data: {
      days: inRange.map((day, index) => ({ ...day, sort: index })),
      created: missing.length,
      orphanedDates: all.filter((d) => !wantedSet.has(d.date)).map((d) => d.date),
    },
  };
}

export async function updateConferenceDay(
  dayId: string,
  patch: { dayProfile?: ConferenceDayProfile; label?: string | null }
): Promise<Result<ConferenceDayRow>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  if (patch.dayProfile && !DAY_PROFILES.includes(patch.dayProfile)) {
    return { success: false, error: `Invalid day profile: ${patch.dayProfile}` };
  }

  const db = createAdminClient();
  const update: Tables["conference_days"]["Update"] = {
    updated_at: new Date().toISOString(),
  };
  if (patch.dayProfile !== undefined) update.day_profile = patch.dayProfile;
  if (patch.label !== undefined) update.label = patch.label;

  const { data, error } = await db
    .from("conference_days")
    .update(update)
    .eq("id", dayId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, data };
}

/** Delete a day. Meal services on the day cascade; education sessions detach. */
export async function deleteConferenceDay(dayId: string): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { error } = await db.from("conference_days").delete().eq("id", dayId);
  if (error) return { success: false, error: error.message };
  return { success: true, data: null };
}
