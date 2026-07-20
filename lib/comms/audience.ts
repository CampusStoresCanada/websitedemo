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

    case "conference_holders":
      return resolveConferenceHolders(supabase, audience.filters ?? {});

    case "conference_orgs_with_open_seats":
      return resolveConferenceOrgsBySeatStatus(supabase, audience.filters ?? {}, true);

    case "conference_orgs_fully_assigned":
      return resolveConferenceOrgsBySeatStatus(supabase, audience.filters ?? {}, false);

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
      `id, user_id, contact_email, display_name, conference_id,
       conference_registrations!inner(registration_type)`
    )
    .eq("conference_registrations.registration_type", "member");

  if (filters?.conference_instance_id) {
    q = q.eq("conference_id", filters.conference_instance_id);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/audience] resolveConferenceDelegates error:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id ?? null,
    email: row.contact_email ?? "",
    name: row.display_name ?? null,
  })).filter((r) => r.email !== "");
}

// ── Conference Exhibitors ─────────────────────────────────────────

async function resolveConferenceExhibitors(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  let q = supabase
    .from("conference_people")
    .select(
      `id, user_id, contact_email, display_name, conference_id,
       conference_registrations!inner(registration_type)`
    )
    .eq("conference_registrations.registration_type", "partner");

  if (filters?.conference_instance_id) {
    q = q.eq("conference_id", filters.conference_instance_id);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/audience] resolveConferenceExhibitors error:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id ?? null,
    email: row.contact_email ?? "",
    name: row.display_name ?? null,
  })).filter((r) => r.email !== "");
}

// ── All Conference Attendees ──────────────────────────────────────

async function resolveConferenceAll(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  let q = supabase
    .from("conference_people")
    .select("id, user_id, contact_email, display_name, conference_id");

  if (filters?.conference_instance_id) {
    q = q.eq("conference_id", filters.conference_instance_id);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/audience] resolveConferenceAll error:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id ?? null,
    email: row.contact_email ?? "",
    name: row.display_name ?? null,
  })).filter((r) => r.email !== "");
}

// ── Conference Seat-Holders (v3) ──────────────────────────────────
// People targeted by what they HOLD in the v3 graph — not a registration_type
// label. Optional seat_kind narrows to e.g. everyone holding a "booth". Reads
// entity_balance_seats → conference_people, so manually added attendees count too.

async function resolveConferenceHolders(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  const conferenceId = filters?.conference_instance_id;
  if (!conferenceId) {
    console.warn("[comms/audience] resolveConferenceHolders: missing conference_instance_id filter");
    return [];
  }
  const seatKind = filters?.seat_kind?.trim() || null;

  const { data: seats, error } = await supabase
    .from("entity_balance_seats")
    .select("holder_person_id, entity:conference_entities!entity_balance_seats_entity_id_fkey(kind)")
    .eq("conference_id", conferenceId)
    .not("holder_person_id", "is", null);
  if (error) {
    console.error("[comms/audience] resolveConferenceHolders error:", error);
    return [];
  }

  const personIds = new Set<string>();
  for (const s of seats ?? []) {
    if (!s.holder_person_id) continue;
    if (seatKind) {
      const entity = Array.isArray(s.entity) ? s.entity[0] : s.entity;
      if (entity?.kind !== seatKind) continue;
    }
    personIds.add(s.holder_person_id);
  }
  if (personIds.size === 0) return [];

  const { data: people, error: peopleError } = await supabase
    .from("conference_people")
    .select("user_id, contact_email, display_name")
    .in("id", [...personIds]);
  if (peopleError) {
    console.error("[comms/audience] resolveConferenceHolders people error:", peopleError);
    return [];
  }

  return (people ?? [])
    .map((row) => ({
      userId: row.user_id ?? null,
      email: row.contact_email ?? "",
      name: row.display_name ?? null,
    }))
    .filter((r) => r.email !== "");
}

// ── Conference Orgs by Seat-Assignment Status (v3) ────────────────
// Targets the ORG's admin contacts, not seat-holders — for nudging orgs to
// go assign remaining seats vs. following up once they have. Optional
// seat_kind narrows to one entity kind (e.g. "registration"); unset = any.
// "Open seats" and "fully assigned" are the two halves of the same
// per-org tally, not independent queries.

async function resolveConferenceOrgsBySeatStatus(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"],
  wantOpenSeats: boolean
): Promise<ResolvedRecipient[]> {
  const conferenceId = filters?.conference_instance_id;
  if (!conferenceId) {
    console.warn("[comms/audience] resolveConferenceOrgsBySeatStatus: missing conference_instance_id filter");
    return [];
  }
  const seatKind = filters?.seat_kind?.trim() || null;

  const { data: seats, error } = await supabase
    .from("entity_balance_seats")
    .select(
      `holder_person_id,
       balance:entity_balances!entity_balance_seats_balance_id_fkey(
         organization_id,
         entity:conference_entities!entity_balances_entity_id_fkey(kind)
       )`
    )
    .eq("conference_id", conferenceId);
  if (error) {
    console.error("[comms/audience] resolveConferenceOrgsBySeatStatus error:", error);
    return [];
  }

  const orgSeatCounts = new Map<string, { total: number; open: number }>();
  for (const s of seats ?? []) {
    const balance = Array.isArray(s.balance) ? s.balance[0] : s.balance;
    const orgId = balance?.organization_id;
    if (!orgId) continue;
    if (seatKind) {
      const entity = Array.isArray(balance?.entity) ? balance.entity[0] : balance?.entity;
      if (entity?.kind !== seatKind) continue;
    }
    const counts = orgSeatCounts.get(orgId) ?? { total: 0, open: 0 };
    counts.total += 1;
    if (!s.holder_person_id) counts.open += 1;
    orgSeatCounts.set(orgId, counts);
  }

  const matchingOrgIds = [...orgSeatCounts.entries()]
    .filter(([, c]) => (wantOpenSeats ? c.open > 0 : c.total > 0 && c.open === 0))
    .map(([orgId]) => orgId);
  if (matchingOrgIds.length === 0) return [];

  return resolveOrgAdmins(supabase, { org_ids: matchingOrgIds });
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
       profiles(id, display_name),
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

  // Resolve emails via auth.users admin lookup (profiles table has no email column)
  const userIds = (data ?? []).map((row) => row.user_id).filter(Boolean);
  const { data: authUsers } = await supabase.auth.admin.listUsers();
  const emailMap = Object.fromEntries(
    (authUsers?.users ?? [])
      .filter((u) => userIds.includes(u.id))
      .map((u) => [u.id, u.email ?? ""])
  );

  const results: ResolvedRecipient[] = [];
  for (const row of data ?? []) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!profile) continue;
    results.push({
      userId: row.user_id,
      email: emailMap[row.user_id] ?? "",
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
