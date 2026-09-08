"use server";

/**
 * Reading and writing one conference's badge scan rules.
 *
 * ⛔ The options are ENUMERATED from live data, never typed in. An admin picking
 * from the organisation types that actually exist cannot invent "Vendor Partnr"
 * and watch the consent gate quietly stop firing; and a type that appears later
 * shows up on its own, unassigned and visible, instead of being silently
 * governed by a fallback nobody knew was running. Same reconciliation the badge
 * arrangement editor does against the registration catalogue.
 */

import { revalidatePath } from "next/cache";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeBadgeScanRules,
  type BadgeScanRules,
} from "@/lib/conference/badges/rules";

export type BadgeScanRuleOptions = {
  /** Every organisation type in use right now. */
  orgTypes: string[];
  /** Every day this conference has, in date order. */
  days: Array<{ id: string; name: string; date: string | null }>;
  rules: BadgeScanRules;
};

export async function loadBadgeScanRuleOptions(
  conferenceId: string
): Promise<{ ok: true; data: BadgeScanRuleOptions } | { ok: false; error: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = createAdminClient();
  const [orgRes, dayRes, confRes] = await Promise.all([
    db.from("organizations").select("type").is("archived_at", null),
    db
      .from("conference_entities")
      .select("id, name, attributes")
      .eq("conference_id", conferenceId)
      .eq("kind", "day"),
    db
      .from("conference_instances")
      .select("badge_scan_rules")
      .eq("id", conferenceId)
      .maybeSingle(),
  ]);

  const orgTypes = [
    ...new Set(
      (orgRes.data ?? [])
        .map((row) => (typeof row.type === "string" ? row.type.trim() : ""))
        .filter(Boolean)
    ),
  ].sort();

  const days = (dayRes.data ?? [])
    .map((row) => {
      const attributes = (row.attributes ?? {}) as Record<string, unknown>;
      const date = typeof attributes.date === "string" ? attributes.date : null;
      return { id: row.id as string, name: (row.name as string) ?? "", date };
    })
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));

  return {
    ok: true,
    data: {
      orgTypes,
      days,
      rules: normalizeBadgeScanRules(confRes.data?.badge_scan_rules),
    },
  };
}

export async function saveBadgeScanRules(
  conferenceId: string,
  rules: BadgeScanRules
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Normalised on the way in as well as the way out: this is the consent gate,
  // and a malformed value here is the difference between asking an attendee and
  // not.
  const clean = normalizeBadgeScanRules(rules);
  const { error } = await createAdminClient()
    .from("conference_instances")
    .update({ badge_scan_rules: clean })
    .eq("id", conferenceId);
  if (error) return { ok: false, error: `Could not save the rules: ${error.message}` };

  revalidatePath(`/admin/conference/${conferenceId}/badges`);
  return { ok: true };
}
