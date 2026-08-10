// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Audience Resolver
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds as lookupUserEmails } from "@/lib/supabase/user-lookup";
import { deriveRecipientNameVariables, formatConferenceDates } from "./format";
import { getConditionsByKeys } from "./conditions/store";
import { evaluateCondition } from "./conditions/evaluate";
import { deriveSubjectVariables } from "./variables/deriveSubjectVariables";
import { filterSuppressedRecipients } from "./suppressions";
import type { SystemVariableKey } from "./variables/registry";
import type { AudienceDefinition, ResolvedRecipient, TemplateCategory } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

type ConferenceVariables = Partial<
  Pick<Record<SystemVariableKey, string>, "conference_year" | "conference_dates" | "conference_location">
>;
type OrgVariables = Partial<Pick<Record<SystemVariableKey, string>, "org_name">>;
type EventVariables = Partial<Pick<Record<SystemVariableKey, string>, "event_name" | "event_date">>;

/**
 * {{conference_year}}/{{conference_dates}}/{{conference_location}} for
 * every recipient of a conference-scoped audience — fetched once per
 * resolve call, not once per recipient, since it's the same conference
 * for the whole batch.
 */
async function loadConferenceVariables(
  supabase: AdminClient,
  conferenceId: string | undefined
): Promise<ConferenceVariables> {
  if (!conferenceId) return {};
  const { data: conference } = await supabase
    .from("conference_instances")
    .select("year, start_date, end_date, location_city, location_province, location_venue")
    .eq("id", conferenceId)
    .maybeSingle();
  if (!conference) return {};

  return {
    conference_year: String(conference.year),
    conference_dates: formatConferenceDates(conference.start_date, conference.end_date),
    conference_location: [conference.location_venue, conference.location_city, conference.location_province]
      .filter(Boolean)
      .join(", "),
  };
}

/**
 * organization_* variables (every field CONDITION_SUBJECTS knows about an
 * org — logo, membership status, payment status, website, ...), fetched
 * once for every distinct org id in the batch rather than once per
 * recipient.
 */
async function batchLoadOrganizationVariables(
  supabase: AdminClient,
  orgIds: (string | null | undefined)[]
): Promise<Map<string, Record<string, string>>> {
  const ids = [...new Set(orgIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const { data: orgs } = await supabase.from("organizations").select("*").in("id", ids);
  return new Map((orgs ?? []).map((org) => [org.id, deriveSubjectVariables("organization", org)]));
}

/**
 * person_* variables (display_name, avatar_url, global_role), batched the
 * same way as organization variables above.
 */
async function batchLoadPersonVariables(
  supabase: AdminClient,
  userIds: (string | null | undefined)[]
): Promise<Map<string, Record<string, string>>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const { data: profiles } = await supabase.from("profiles").select("*").in("id", ids);
  return new Map((profiles ?? []).map((p) => [p.id, deriveSubjectVariables("person", p)]));
}

/**
 * Narrow a resolved recipient list by a group of saved conditions, combined
 * either as ALL (every condition must hold) or ANY (at least one must
 * hold). Shared by both segmentation gates in resolveAudience below.
 */
async function applyConditionGate(
  supabase: AdminClient,
  recipients: ResolvedRecipient[],
  keys: string[] | undefined,
  matchMode: "all" | "any"
): Promise<ResolvedRecipient[]> {
  const conditionKeys = keys ?? [];
  if (conditionKeys.length === 0) return recipients;

  const conditions = await getConditionsByKeys(conditionKeys);
  if (conditions.length === 0) return recipients;

  const results = await Promise.all(
    recipients.map(async (r) => {
      // No resolvable identity (custom_emails/custom_recipient_list) —
      // can't check a condition, so it passes through rather than being
      // silently dropped.
      if (!r.userId) return { recipient: r, keep: true };
      const satisfactions = await Promise.all(
        conditions.map((c) => evaluateCondition(supabase, c, { userId: r.userId!, email: r.email }))
      );
      const keep = matchMode === "any" ? satisfactions.some(Boolean) : satisfactions.every(Boolean);
      return { recipient: r, keep };
    })
  );

  return results.filter((r) => r.keep).map((r) => r.recipient);
}

/**
 * Resolve an audience definition to a list of concrete recipients, then
 * narrow by two independent condition gates (segmentation — see
 * lib/comms/conditions/): the audience's own filters.condition_keys, and
 * the parent campaign's filters.campaign_condition_keys (set by
 * resolveEffectiveAudience). Each gate can independently be ALL or ANY;
 * the two gates themselves are always AND'd together — "in this segment"
 * and "still relevant to the campaign" are different concerns, not
 * something an admin would want to OR.
 */
export async function resolveAudience(
  audience: AudienceDefinition
): Promise<ResolvedRecipient[]> {
  const supabase = createAdminClient();
  let recipients = await resolveAudienceByType(supabase, audience);

  recipients = await applyConditionGate(
    supabase,
    recipients,
    audience.filters?.condition_keys,
    audience.filters?.condition_match ?? "all"
  );
  recipients = await applyConditionGate(
    supabase,
    recipients,
    audience.filters?.campaign_condition_keys,
    audience.filters?.campaign_condition_match ?? "all"
  );

  return recipients;
}

async function resolveAudienceByType(
  supabase: AdminClient,
  audience: AudienceDefinition
): Promise<ResolvedRecipient[]> {
  switch (audience.type) {
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

    case "contact_tags":
      return resolveContactTags(supabase, audience.filters ?? {});

    case "custom_emails":
      return resolveCustomEmails(audience.filters?.emails ?? []);

    case "custom_recipient_list":
      return resolveCustomRecipientList(audience.filters?.recipients ?? []);

    default:
      console.warn("[comms/audience] Unknown audience type:", audience.type);
      return [];
  }
}


// ── All Conference Attendees ──────────────────────────────────────

async function resolveConferenceAll(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  let q = supabase
    .from("conference_people")
    .select("id, user_id, contact_email, display_name, conference_id, organization_id");

  if (filters?.conference_instance_id) {
    q = q.eq("conference_id", filters.conference_instance_id);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/audience] resolveConferenceAll error:", error);
    return [];
  }

  const conferenceVars = await loadConferenceVariables(supabase, filters?.conference_instance_id);
  const orgVarsByOrgId = await batchLoadOrganizationVariables(supabase, (data ?? []).map((r) => r.organization_id));
  const personVarsByUserId = await batchLoadPersonVariables(supabase, (data ?? []).map((r) => r.user_id));

  return (data ?? []).map((row) => ({
    userId: row.user_id ?? null,
    email: row.contact_email ?? "",
    name: row.display_name ?? null,
    variableOverrides: {
      ...deriveRecipientNameVariables(row.display_name, row.contact_email ?? ""),
      ...conferenceVars,
      ...(row.organization_id ? orgVarsByOrgId.get(row.organization_id) : {}),
      ...(row.user_id ? personVarsByUserId.get(row.user_id) : {}),
    },
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
  const entityId = filters?.entity_id?.trim() || null;
  const seatKind = entityId ? null : filters?.seat_kind?.trim() || null;

  let q = supabase
    .from("entity_balance_seats")
    .select("holder_person_id, entity:conference_entities!entity_balance_seats_entity_id_fkey(kind)")
    .eq("conference_id", conferenceId)
    .not("holder_person_id", "is", null);
  if (entityId) {
    q = q.eq("entity_id", entityId);
  }

  const { data: seats, error } = await q;
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
    .select("user_id, contact_email, display_name, organization_id")
    .in("id", [...personIds]);
  if (peopleError) {
    console.error("[comms/audience] resolveConferenceHolders people error:", peopleError);
    return [];
  }

  const conferenceVars = await loadConferenceVariables(supabase, conferenceId);
  const orgVarsByOrgId = await batchLoadOrganizationVariables(supabase, (people ?? []).map((r) => r.organization_id));
  const personVarsByUserId = await batchLoadPersonVariables(supabase, (people ?? []).map((r) => r.user_id));

  return (people ?? [])
    .map((row) => ({
      userId: row.user_id ?? null,
      email: row.contact_email ?? "",
      name: row.display_name ?? null,
      variableOverrides: {
        ...deriveRecipientNameVariables(row.display_name, row.contact_email ?? ""),
        ...conferenceVars,
        ...(row.organization_id ? orgVarsByOrgId.get(row.organization_id) : {}),
        ...(row.user_id ? personVarsByUserId.get(row.user_id) : {}),
      },
    }))
    .filter((r) => r.email !== "");
}

// ── Conference Orgs by Seat-Assignment Status (v3) ────────────────
// Targets the ORG's admin contacts, not seat-holders — for nudging orgs to
// go assign remaining seats vs. following up once they have. entity_id
// narrows to one specific catalog item (e.g. one named booth tier);
// seat_kind narrows to a whole kind (e.g. "booth") when entity_id is unset.
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
  const entityId = filters?.entity_id?.trim() || null;
  const seatKind = entityId ? null : filters?.seat_kind?.trim() || null;

  let q = supabase
    .from("entity_balance_seats")
    .select(
      `holder_person_id,
       balance:entity_balances!entity_balance_seats_balance_id_fkey(
         organization_id,
         entity:conference_entities!entity_balances_entity_id_fkey(kind)
       )`
    )
    .eq("conference_id", conferenceId);
  if (entityId) {
    q = q.eq("entity_id", entityId);
  }

  const { data: seats, error } = await q;
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

  const orgAdmins = await resolveOrgAdmins(supabase, { org_ids: matchingOrgIds });
  const conferenceVars = await loadConferenceVariables(supabase, conferenceId);
  if (Object.keys(conferenceVars).length === 0) return orgAdmins;

  return orgAdmins.map((r) => ({
    ...r,
    variableOverrides: { ...r.variableOverrides, ...conferenceVars },
  }));
}

// ── Global Admins (admin + super_admin) ───────────────────────────

async function resolveGlobalAdmins(
  supabase: AdminClient
): Promise<ResolvedRecipient[]> {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("*")
    .in("global_role", ["admin", "super_admin"]);

  if (error) {
    console.error("[comms/audience] resolveGlobalAdmins error:", error);
    return [];
  }

  if (!profiles?.length) return [];

  const ids = profiles.map((p) => p.id);
  const emailMap = await lookupUserEmails(supabase, ids);

  return profiles
    .map((p) => ({
      userId: p.id,
      email: emailMap[p.id] ?? "",
      name: p.display_name ?? null,
      variableOverrides: {
        ...deriveRecipientNameVariables(p.display_name, emailMap[p.id] ?? ""),
        ...deriveSubjectVariables("person", p),
      },
    }))
    .filter((r) => r.email);
}

// ── Org Admins ────────────────────────────────────────────────────

async function resolveOrgAdmins(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  // No embedded profiles(...) join here on purpose: user_organizations.user_id
  // and profiles.id both reference auth.users.id independently, with no direct
  // FK between the two tables, so PostgREST can't auto-detect the relationship
  // for an embedded select (confirmed via PGRST200 at runtime). Two plain
  // queries instead, same pattern as resolveEventRegistrants below.
  const roles = filters?.roles?.length ? filters.roles : ["org_admin"];
  let q = supabase.from("user_organizations").select("user_id, organization_id").in("role", roles).eq("status", "active");

  if (filters?.org_ids?.length) {
    q = q.in("organization_id", filters.org_ids);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/audience] resolveOrgAdmins error:", error);
    return [];
  }

  const userIds = [...new Set((data ?? []).map((row) => row.user_id).filter(Boolean))];
  if (userIds.length === 0) return [];

  // A user can admin more than one org; first match is good enough for a
  // personalization convenience, not a strict guarantee.
  const orgIdByUserId = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.user_id && row.organization_id && !orgIdByUserId.has(row.user_id)) {
      orgIdByUserId.set(row.user_id, row.organization_id);
    }
  }
  const { data: allOrgs } = await supabase
    .from("organizations")
    .select("*")
    .in("id", [...new Set(orgIdByUserId.values())]);

  // Test orgs never belong in a real send, and org_type (e.g. "Vendor
  // Partner" vs "Member") is the only way today to scope org_admins to one
  // side of the membership — there's no dedicated audience type for it.
  const orgs = (allOrgs ?? []).filter((o) => {
    if (o.is_test) return false;
    if (filters?.org_type && o.type !== filters.org_type) return false;
    return true;
  });
  const allowedOrgIds = new Set(orgs.map((o) => o.id));
  for (const [uid, orgId] of orgIdByUserId) {
    if (!allowedOrgIds.has(orgId)) orgIdByUserId.delete(uid);
  }
  const filteredUserIds = userIds.filter((uid) => orgIdByUserId.has(uid));

  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));
  const orgVarsById = new Map(orgs.map((o) => [o.id, deriveSubjectVariables("organization", o)]));

  if (filteredUserIds.length === 0) return [];

  const { data: profiles } = await supabase.from("profiles").select("*").in("id", filteredUserIds);
  const nameMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name]));
  const personVarsById = new Map((profiles ?? []).map((p) => [p.id, deriveSubjectVariables("person", p)]));

  // Resolve emails via auth.users admin lookup (profiles table has no email column)
  const emailMap = await lookupUserEmails(supabase, filteredUserIds);

  return filteredUserIds
    .map((uid) => {
      const orgId = orgIdByUserId.get(uid);
      return {
        userId: uid,
        email: emailMap[uid] ?? "",
        name: nameMap[uid] ?? null,
        variableOverrides: {
          ...deriveRecipientNameVariables(nameMap[uid] ?? null, emailMap[uid] ?? ""),
          ...((orgId && orgNameById.get(orgId) ? { org_name: orgNameById.get(orgId)! } : {}) satisfies OrgVariables),
          ...(orgId ? orgVarsById.get(orgId) : {}),
          ...personVarsById.get(uid),
        },
      };
    })
    .filter((r) => r.email);
}

// ── Contact tags (non-member segmentation) ─────────────────────────

/**
 * Contacts tagged with any of the given lib/contacts/tags.ts values —
 * lapsed members/partners, prospects, conference-only attendees, board/
 * committee, external vendors. These contacts never have a user_id (they
 * never get a portal login by design), so userId is always null here.
 */
async function resolveContactTags(
  supabase: AdminClient,
  filters: AudienceDefinition["filters"]
): Promise<ResolvedRecipient[]> {
  const tags = filters?.tags ?? [];
  if (tags.length === 0) {
    console.warn("[comms/audience] resolveContactTags: missing tags filter");
    return [];
  }

  let q = supabase
    .from("contacts")
    .select("id, name, email, work_email, organization_id")
    .overlaps("contact_type", tags)
    .is("archived_at", null);

  if (filters?.org_ids?.length) {
    q = q.in("organization_id", filters.org_ids);
  }

  const { data, error } = await q;
  if (error) {
    console.error("[comms/audience] resolveContactTags error:", error);
    return [];
  }

  const orgVarsByOrgId = await batchLoadOrganizationVariables(supabase, (data ?? []).map((c) => c.organization_id));

  return (data ?? [])
    .map((c) => {
      const email = c.work_email ?? c.email ?? "";
      return {
        userId: null,
        email,
        name: c.name,
        variableOverrides: {
          ...deriveRecipientNameVariables(c.name, email),
          ...(c.organization_id ? orgVarsByOrgId.get(c.organization_id) : {}),
        },
      };
    })
    .filter((r) => r.email);
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
    .select("user_id, status, payment_status")
    .eq("event_id", filters.event_id)
    .in("status", ["registered", "promoted"]);

  if (error) {
    console.error("[comms/audience] resolveEventRegistrants error:", error);
    return [];
  }

  const userIds = (regs ?? []).map((r) => r.user_id);
  if (!userIds.length) return [];

  const registrationByUserId = new Map((regs ?? []).map((r) => [r.user_id, r]));

  // Resolve names from profiles
  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .in("id", userIds);

  const nameMap = Object.fromEntries(
    (profiles ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name])
  );
  const personVarsById = new Map((profiles ?? []).map((p) => [p.id, deriveSubjectVariables("person", p)]));

  // Resolve emails from auth.users
  const emailMap = await lookupUserEmails(supabase, userIds);

  const { data: event } = await supabase
    .from("events")
    .select("title, starts_at")
    .eq("id", filters.event_id)
    .maybeSingle();
  const eventVars: EventVariables = event
    ? {
        event_name: event.title,
        event_date: event.starts_at
          ? new Date(event.starts_at).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })
          : "",
      }
    : {};

  return userIds
    .map((uid) => ({
      userId: uid,
      email: emailMap[uid] ?? "",
      name: nameMap[uid] ?? null,
      variableOverrides: {
        ...deriveRecipientNameVariables(nameMap[uid] ?? null, emailMap[uid] ?? ""),
        ...eventVars,
        ...personVarsById.get(uid),
        ...deriveSubjectVariables("event_registration", registrationByUserId.get(uid) ?? null),
      },
    }))
    .filter((r) => r.email);
}

// ── Custom email list ─────────────────────────────────────────────

function resolveCustomEmails(emails: string[]): ResolvedRecipient[] {
  return emails.map((email) => ({
    userId: null,
    email,
    name: null,
    variableOverrides: deriveRecipientNameVariables(null, email),
  }));
}

function resolveCustomRecipientList(
  recipients: NonNullable<AudienceDefinition["filters"]>["recipients"]
): ResolvedRecipient[] {
  return (recipients ?? []).map((r) => ({
    userId: null,
    email: r.email,
    name: r.name ?? null,
    // Explicit CSV values win — auto-derived name vars are only a fallback
    // for whatever the admin's own columns didn't cover.
    variableOverrides: { ...deriveRecipientNameVariables(r.name ?? null, r.email), ...r.variableOverrides },
  }));
}

/**
 * Preview an audience without persisting — returns count + sample.
 */
/**
 * @param suppressionCategory Omit to skip suppression filtering entirely
 * (e.g. a transactional template). Pass null to check only the global
 * unsubscribe, or a category to also check that category's suppressions —
 * mirrors executeCampaignSend's own filtering so the preview count matches
 * what will actually send.
 */
export async function previewAudience(
  audience: AudienceDefinition,
  suppressionCategory?: TemplateCategory | null
): Promise<{
  count: number;
  sample: ResolvedRecipient[];
}> {
  let resolved = await resolveAudience(audience);
  if (suppressionCategory !== undefined) {
    const supabase = createAdminClient();
    resolved = await filterSuppressedRecipients(supabase, resolved, suppressionCategory);
  }
  return {
    count: resolved.length,
    sample: resolved.slice(0, 5),
  };
}
