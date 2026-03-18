// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Audience Resolver
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import type { AudienceDefinition, ResolvedRecipient } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Resolve an audience definition to a list of concrete recipients.
 */
export async function resolveAudience(
  audience: AudienceDefinition
): Promise<ResolvedRecipient[]> {
  const supabase = createAdminClient();

  switch (audience.type) {
    case "conference_delegates":
      return resolveConferenceDelegates(supabase, audience.filters ?? {});

    case "conference_exhibitors":
      return resolveConferenceExhibitors(supabase, audience.filters ?? {});

    case "conference_all":
      return resolveConferenceAll(supabase, audience.filters ?? {});

    case "global_admins":
      return resolveGlobalAdmins(supabase);

    case "org_admins":
      return resolveOrgAdmins(supabase, audience.filters ?? {});

    case "event_registrants":
      return resolveEventRegistrants(supabase, audience.filters ?? {});

    case "custom_emails":
      return resolveCustomEmails(audience.filters?.emails ?? []);

    default:
      console.warn("[comms/audience] Unknown audience type:", audience.type);
      return [];
  }
}

// ── Conference Delegates ──────────────────────────────────────────

async function resolveConferenceDelegates(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  let q = supabase
    .from("conference_people")
    .select(
      `id, user_id, contact_email, full_name, conference_instance_id,
       conference_registrations!inner(registration_type)`
    )
    .eq("conference_registrations.registration_type", "member");

  if (filters?.conference_instance_id) {
    q = q.eq("conference_instance_id", filters.conference_instance_id);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/audience] resolveConferenceDelegates error:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id ?? null,
    email: row.contact_email,
    name: row.full_name ?? null,
  }));
}

// ── Conference Exhibitors ─────────────────────────────────────────

async function resolveConferenceExhibitors(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  let q = supabase
    .from("conference_people")
    .select(
      `id, user_id, contact_email, full_name, conference_instance_id,
       conference_registrations!inner(registration_type)`
    )
    .eq("conference_registrations.registration_type", "partner");

  if (filters?.conference_instance_id) {
    q = q.eq("conference_instance_id", filters.conference_instance_id);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/audience] resolveConferenceExhibitors error:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id ?? null,
    email: row.contact_email,
    name: row.full_name ?? null,
  }));
}

// ── All Conference Attendees ──────────────────────────────────────

async function resolveConferenceAll(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  let q = supabase
    .from("conference_people")
    .select("id, user_id, contact_email, full_name, conference_instance_id");

  if (filters?.conference_instance_id) {
    q = q.eq("conference_instance_id", filters.conference_instance_id);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/audience] resolveConferenceAll error:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id ?? null,
    email: row.contact_email,
    name: row.full_name ?? null,
  }));
}

// ── Global Admins (admin + super_admin) ───────────────────────────

async function resolveGlobalAdmins(
  supabase: AdminClient
): Promise<ResolvedRecipient[]> {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, display_name, global_role")
    .in("global_role", ["admin", "super_admin"]);

  if (error) {
    console.error("[comms/audience] resolveGlobalAdmins error:", error);
    return [];
  }

  if (!profiles?.length) return [];

  const ids = profiles.map((p) => p.id);
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const emailMap = Object.fromEntries(
    (authUsers?.users ?? [])
      .filter((u) => ids.includes(u.id))
      .map((u) => [u.id, u.email ?? ""])
  );

  return profiles
    .map((p) => ({
      userId: p.id,
      email: emailMap[p.id] ?? "",
      name: p.display_name ?? null,
    }))
    .filter((r) => r.email);
}

// ── Org Admins ────────────────────────────────────────────────────

async function resolveOrgAdmins(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  let q = supabase
    .from("user_organizations")
    .select(
      `user_id, role,
       profiles(id, email:auth.users(email), display_name),
       organizations(id)`
    )
    .eq("role", "org_admin")
    .eq("active", true);

  if (filters?.org_ids?.length) {
    q = q.in("org_id", filters.org_ids);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/audience] resolveOrgAdmins error:", error);
    return [];
  }

  // Fall back to auth.users lookup for email if profile join fails
  const results: ResolvedRecipient[] = [];
  for (const row of data ?? []) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!profile) continue;
    results.push({
      userId: row.user_id,
      email: (profile as { email?: string }).email ?? "",
      name: (profile as { display_name?: string }).display_name ?? null,
    });
  }
  return results.filter((r) => r.email);
}

// ── Event Registrants ─────────────────────────────────────────────

async function resolveEventRegistrants(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  if (!filters?.event_id) {
    console.warn("[comms/audience] resolveEventRegistrants: missing event_id filter");
    return [];
  }

  const { data: regs, error } = await supabase
    .from("event_registrations")
    .select("user_id")
    .eq("event_id", filters.event_id)
    .in("status", ["registered", "promoted"]);

  if (error) {
    console.error("[comms/audience] resolveEventRegistrants error:", error);
    return [];
  }

  const userIds = (regs ?? []).map((r: { user_id: string }) => r.user_id);
  if (!userIds.length) return [];

  // Resolve names from profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);

  const nameMap = Object.fromEntries(
    (profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name])
  );

  // Resolve emails from auth.users
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const emailMap = Object.fromEntries(
    (authUsers?.users ?? [])
      .filter((u) => userIds.includes(u.id))
      .map((u) => [u.id, u.email ?? ""])
  );

  return userIds
    .map((uid) => ({
      userId: uid,
      email: emailMap[uid] ?? "",
      name: nameMap[uid] ?? null,
    }))
    .filter((r) => r.email);
}

// ── Custom email list ─────────────────────────────────────────────

function resolveCustomEmails(emails: string[]): ResolvedRecipient[] {
  return emails.map((email) => ({
    userId: null,
    email,
    name: null,
  }));
}

/**
 * Preview an audience without persisting — returns count + sample.
 */
export async function previewAudience(audience: AudienceDefinition): Promise<{
  count: number;
  sample: ResolvedRecipient[];
}> {
  const resolved = await resolveAudience(audience);
  return {
    count: resolved.length,
    sample: resolved.slice(0, 5),
  };
}
