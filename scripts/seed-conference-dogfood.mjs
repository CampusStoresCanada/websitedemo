#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function inferRegistrationType(org) {
  const value = `${org.type ?? ""} ${org.organization_type ?? ""}`.toLowerCase();
  if (
    value.includes("partner") ||
    value.includes("vendor") ||
    value.includes("exhibitor") ||
    value.includes("supplier")
  ) {
    return "exhibitor";
  }
  return "delegate";
}

function isExhibitorOrg(org) {
  return inferRegistrationType(org) === "exhibitor";
}

async function main() {
  const { data: conferences, error: conferenceError } = await supabase
    .from("conference_instances")
    .select("id,name,year,edition_code,created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (conferenceError) throw conferenceError;
  const conference = conferences?.[0];
  if (!conference) {
    throw new Error("No conference_instances row found.");
  }

  const { data: links, error: linkError } = await supabase
    .from("user_organizations")
    .select("user_id, organization_id, role, status")
    .eq("status", "active")
    .limit(300);

  if (linkError) throw linkError;

  const uniqueUserIds = [...new Set((links ?? []).map((row) => row.user_id))];
  const uniqueOrgIds = [...new Set((links ?? []).map((row) => row.organization_id))];

  const [{ data: profiles, error: profileError }, { data: orgs, error: orgError }] =
    await Promise.all([
      supabase.from("profiles").select("id,display_name").in("id", uniqueUserIds),
      supabase
        .from("organizations")
        .select("id,name,email,type,organization_type")
        .in("id", uniqueOrgIds),
    ]);

  if (profileError) throw profileError;
  if (orgError) throw orgError;

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const orgMap = new Map((orgs ?? []).map((o) => [o.id, o]));

  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("id,organization_id,name,email,work_email,role_title")
    .in("organization_id", uniqueOrgIds);
  if (contactsError) throw contactsError;
  const contactsByOrg = new Map();
  for (const contact of contacts ?? []) {
    const orgId = contact.organization_id;
    if (!orgId) continue;
    const list = contactsByOrg.get(orgId) ?? [];
    list.push(contact);
    contactsByOrg.set(orgId, list);
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function resolveContact(row) {
    const candidates = contactsByOrg.get(row.link.organization_id) ?? [];
    if (!candidates.length) return null;
    const display = normalize(row.profile.display_name);
    const orgEmail = normalize(row.org.email);
    let best = candidates.find((c) => normalize(c.name) === display) ?? null;
    if (!best && orgEmail) {
      best =
        candidates.find((c) => normalize(c.work_email) === orgEmail) ??
        candidates.find((c) => normalize(c.email) === orgEmail) ??
        null;
    }
    if (!best) best = candidates[0];
    return best;
  }

  const seenUsers = new Set();
  const selected = [];
  for (const link of links ?? []) {
    if (seenUsers.has(link.user_id)) continue;
    const profile = profileMap.get(link.user_id);
    const org = orgMap.get(link.organization_id);
    if (!profile || !org) continue;
    seenUsers.add(link.user_id);
    selected.push({ link, profile, org });
    if (selected.length >= 18) break;
  }

  if (selected.length < 6) {
    throw new Error(`Not enough active linked users to seed fixture data (found ${selected.length}).`);
  }

  const delegateCandidates = selected.filter((row) => !isExhibitorOrg(row.org));
  const exhibitorCandidates = selected.filter((row) => isExhibitorOrg(row.org));

  const delegateRows = delegateCandidates.slice(0, 12).map((row) => ({
    _contact: resolveContact(row),
    _orgEmail: row.org.email ?? null,
    user_id: row.link.user_id,
    organization_id: row.link.organization_id,
    registration_type: "delegate",
    status: "confirmed",
    assignment_status: "assigned",
    delegate_name: row.profile.display_name ?? row.org.name,
    legal_name: row.profile.display_name ?? row.org.name,
    delegate_title: null,
    delegate_email: null,
    badge_print_status: "not_printed",
  })).map((row) => ({
    ...row,
    delegate_title: row._contact?.role_title ?? null,
    delegate_email: row._contact?.work_email ?? row._contact?.email ?? row.delegate_email ?? row._orgEmail ?? null,
  }));

  const exhibitorRows = exhibitorCandidates.slice(0, 6).map((row) => ({
    _contact: resolveContact(row),
    _orgEmail: row.org.email ?? null,
    user_id: row.link.user_id,
    organization_id: row.link.organization_id,
    registration_type: "exhibitor",
    status: "confirmed",
    assignment_status: "assigned",
    delegate_name: row.profile.display_name ?? row.org.name,
    legal_name: row.profile.display_name ?? row.org.name,
    delegate_title: null,
    delegate_email: null,
    badge_print_status: "not_printed",
  })).map((row) => ({
    ...row,
    delegate_title: row._contact?.role_title ?? null,
    delegate_email: row._contact?.work_email ?? row._contact?.email ?? row.delegate_email ?? row._orgEmail ?? null,
  }));

  const registrationPayload = [...delegateRows, ...exhibitorRows].map((row) => ({
    conference_id: conference.id,
    user_id: row.user_id,
    organization_id: row.organization_id,
    registration_type: row.registration_type,
    status: row.status,
    assignment_status: row.assignment_status,
    delegate_name: row.delegate_name,
    legal_name: row.legal_name,
    delegate_title: row.delegate_title,
    delegate_email: row.delegate_email,
    badge_print_status: row.badge_print_status,
  }));

  if (registrationPayload.length === 0) {
    throw new Error("No eligible rows to seed.");
  }

  const { error: upsertRegError } = await supabase
    .from("conference_registrations")
    .upsert(registrationPayload, { onConflict: "conference_id,user_id,registration_type" });

  if (upsertRegError) throw upsertRegError;

  const seededUserIds = [...new Set(registrationPayload.map((row) => row.user_id))];
  const { data: registrationRows, error: registrationReadError } = await supabase
    .from("conference_registrations")
    .select("id,conference_id,organization_id,user_id,registration_type,delegate_name,legal_name,delegate_title,delegate_email,assignment_status,badge_print_status")
    .eq("conference_id", conference.id)
    .in("user_id", seededUserIds)
    .in("registration_type", ["delegate", "exhibitor", "staff", "observer"]);

  if (registrationReadError) throw registrationReadError;

  const peoplePayload = (registrationRows ?? []).map((row) => ({
    conference_id: row.conference_id,
    organization_id: row.organization_id,
    user_id: row.user_id,
    registration_id: row.id,
    conference_staff_id: null,
    source_type: "registration",
    source_id: row.id,
    person_kind: row.registration_type,
    display_name: row.delegate_name ?? row.legal_name ?? null,
    legal_name: row.legal_name ?? null,
    role_title: row.delegate_title ?? null,
    contact_email: row.delegate_email ?? null,
    assignment_status: row.assignment_status ?? "assigned",
    schedule_scope: row.registration_type === "delegate" ? "person" : "organization",
    schedule_registration_id: row.id,
    badge_print_status: row.badge_print_status ?? "not_printed",
    data_quality_flags: [],
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertPeopleError } = await supabase
    .from("conference_people")
    .upsert(peoplePayload, { onConflict: "conference_id,source_type,source_id" });

  if (upsertPeopleError) throw upsertPeopleError;

  const { data: peopleRows, error: peopleReadError } = await supabase
    .from("conference_people")
    .select("id")
    .eq("conference_id", conference.id)
    .in("source_id", (registrationRows ?? []).map((row) => row.id));

  if (peopleReadError) throw peopleReadError;

  let ensuredTokens = 0;
  for (const person of peopleRows ?? []) {
    const { error: tokenError } = await supabase.rpc("ensure_conference_badge_token_for_person", {
      p_conference_id: conference.id,
      p_person_id: person.id,
      p_actor_id: null,
    });
    if (!tokenError) ensuredTokens += 1;
  }

  const [regCount, peopleCount, tokenCount] = await Promise.all([
    supabase
      .from("conference_registrations")
      .select("id", { count: "exact", head: true })
      .eq("conference_id", conference.id),
    supabase
      .from("conference_people")
      .select("id", { count: "exact", head: true })
      .eq("conference_id", conference.id),
    supabase
      .from("conference_badge_tokens")
      .select("id", { count: "exact", head: true })
      .eq("conference_id", conference.id),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        conference: {
          id: conference.id,
          name: conference.name,
          year: conference.year,
          edition_code: conference.edition_code,
        },
        seeded: {
          registrationPayload: registrationPayload.length,
          peoplePayload: peoplePayload.length,
          tokensEnsured: ensuredTokens,
        },
        totals: {
          registrations: regCount.count ?? 0,
          people: peopleCount.count ?? 0,
          badgeTokens: tokenCount.count ?? 0,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error?.message ?? String(error),
        details: error,
      },
      null,
      2
    )
  );
  process.exit(1);
});
