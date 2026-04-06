#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalize(value) {
  return (value ?? "").trim().toLowerCase();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const apply = hasFlag("--apply");
  const conferenceId = getArg("--conference-id");
  const organizationId = getArg("--organization-id");

  const admin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const membershipQuery = admin
    .from("user_organizations")
    .select("organization_id,user_id,role,status")
    .eq("status", "active");
  if (organizationId) membershipQuery.eq("organization_id", organizationId);

  const { data: memberships, error: membershipError } = await membershipQuery;
  if (membershipError) throw membershipError;

  const memberRows = memberships ?? [];
  const memberUserIds = [...new Set(memberRows.map((row) => row.user_id).filter(Boolean))];

  const profileRows = [];
  for (let i = 0; i < memberUserIds.length; i += 100) {
    const chunk = memberUserIds.slice(i, i + 100);
    const { data, error } = await admin
      .from("profiles")
      .select("id,display_name")
      .in("id", chunk);
    if (error) throw error;
    profileRows.push(...(data ?? []));
  }

  const profileNameById = new Map(
    profileRows.map((row) => [row.id, normalize(row.display_name)])
  );

  const membersByOrg = new Map();
  for (const row of memberRows) {
    if (!row.organization_id || !row.user_id) continue;
    const orgId = row.organization_id;
    const item = {
      userId: row.user_id,
      email: "",
      name: profileNameById.get(row.user_id) ?? "",
    };
    const current = membersByOrg.get(orgId) ?? [];
    current.push(item);
    membersByOrg.set(orgId, current);
  }

  const peopleQuery = admin
    .from("conference_people")
    .select(
      "id,conference_id,organization_id,user_id,source_type,source_id,display_name,contact_email,assignment_status,updated_at"
    )
    .eq("source_type", "entitlement")
    .is("user_id", null)
    .in("assignment_status", ["assigned", "reassigned", "pending_user_activation"]);

  if (conferenceId) peopleQuery.eq("conference_id", conferenceId);
  if (organizationId) peopleQuery.eq("organization_id", organizationId);

  const { data: people, error: peopleError } = await peopleQuery;
  if (peopleError) throw peopleError;

  const candidates = people ?? [];
  const planned = [];
  const skipped = [];

  for (const row of candidates) {
    const orgMembers = membersByOrg.get(row.organization_id) ?? [];
    if (orgMembers.length === 0) {
      skipped.push({ id: row.id, reason: "no_active_org_members" });
      continue;
    }

    const email = normalize(row.contact_email);
    const name = normalize(row.display_name);

    const byEmail = email
      ? orgMembers.filter((member) => member.email && member.email === email)
      : [];

    let matches = byEmail;
    let method = "email";

    if (matches.length === 0 && name) {
      const byName = orgMembers.filter((member) => member.name && member.name === name);
      matches = byName;
      method = "name";
    }

    if (matches.length === 1) {
      planned.push({
        id: row.id,
        conferenceId: row.conference_id,
        organizationId: row.organization_id,
        targetUserId: matches[0].userId,
        method,
        previousStatus: row.assignment_status,
      });
      continue;
    }

    if (matches.length > 1) {
      skipped.push({ id: row.id, reason: `ambiguous_${method}_match` });
      continue;
    }

    skipped.push({ id: row.id, reason: "no_match" });
  }

  let updated = 0;
  const errors = [];
  if (apply) {
    for (const row of planned) {
      const nextStatus =
        row.previousStatus === "pending_user_activation" ? "assigned" : row.previousStatus;
      const { error } = await admin
        .from("conference_people")
        .update({
          user_id: row.targetUserId,
          person_kind: "delegate",
          assignment_status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) {
        errors.push({ id: row.id, error: error.message });
      } else {
        updated += 1;
      }
    }
  }

  const summary = {
    apply,
    filters: {
      conferenceId: conferenceId ?? null,
      organizationId: organizationId ?? null,
    },
    totals: {
      candidateRows: candidates.length,
      plannedUpdates: planned.length,
      skipped: skipped.length,
      updated,
      updateErrors: errors.length,
    },
    samplePlanned: planned.slice(0, 20),
    sampleSkipped: skipped.slice(0, 20),
    sampleErrors: errors.slice(0, 20),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (apply && errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
