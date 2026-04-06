import { NextRequest, NextResponse } from "next/server";
import { getServerAuthState } from "@/lib/auth/server";
import { getCircleClient } from "@/lib/circle/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueCircleSync } from "@/lib/circle/sync";
import { getAccessGroupIds } from "@/lib/circle/config";

export const maxDuration = 60;

const ACTIVE_STATUSES = ["active", "grace", "reactivated"];
const ORG_NAME_ALIASES: Record<string, string[]> = {
  cesium: ["cesium telecom"],
  "cesium telecom": ["cesium"],
};

export async function POST(request: NextRequest) {
  const auth = await getServerAuthState();
  if (!auth.user || auth.globalRole !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getCircleClient();
  if (!client) {
    return NextResponse.json({ error: "Circle not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({})) as { dryRun?: boolean };
  const dryRun = body.dryRun !== false; // default to dry run

  const adminClient = createAdminClient();
  const groupIds = getAccessGroupIds();

  const results = {
    dryRun,
    groupsMapped: 0,
    groupsUnmatched: [] as string[],
    contactsQueued: 0,
    errors: [] as string[],
  };

  // ── Step 1: Map existing Circle access groups to partner org rows ──────────
  const circleGroups = await client.listAccessGroups();

  // Fetch all partner orgs missing a circle_access_group_id
  const { data: partnerOrgs, error: orgsErr } = await adminClient
    .from("organizations")
    .select("id, name, type, circle_access_group_id, membership_status, archived_at")
    .ilike("type", "%partner%")
    .in("membership_status", ACTIVE_STATUSES)
    .is("archived_at", null)
    .is("circle_access_group_id", null);

  if (orgsErr) {
    results.errors.push(`Failed to fetch partner orgs: ${orgsErr.message}`);
  } else if (partnerOrgs) {
    // Build a lowercase name → group map from Circle
    const circleGroupMap = new Map(
      circleGroups.map((g) => [g.name.toLowerCase().trim(), g])
    );

    for (const org of partnerOrgs) {
      const orgNameKey = org.name.toLowerCase().trim();
      const aliasKeys = ORG_NAME_ALIASES[orgNameKey] ?? [];
      const match =
        circleGroupMap.get(orgNameKey) ??
        aliasKeys.map((key) => circleGroupMap.get(key)).find(Boolean);
      if (match) {
        if (!dryRun) {
          const { error } = await adminClient
            .from("organizations")
            .update({ circle_access_group_id: String(match.id) })
            .eq("id", org.id);
          if (error) {
            results.errors.push(`Failed to update org ${org.name}: ${error.message}`);
            continue;
          }
        }
        results.groupsMapped++;
      } else {
        results.groupsUnmatched.push(org.name);
      }
    }
  }

  // ── Step 2: Enqueue add_to_access_group for all active org contacts ────────

  // Re-fetch partner orgs now including newly mapped ones (or simulate in dry run)
  const { data: activePartnerOrgs } = await adminClient
    .from("organizations")
    .select("id, name, circle_access_group_id")
    .ilike("type", "%partner%")
    .in("membership_status", ACTIVE_STATUSES)
    .not("circle_access_group_id", "is", null);

  // Also handle member orgs
  const { data: activeMemberOrgs } = await adminClient
    .from("organizations")
    .select("id, name")
    .not("type", "ilike", "%partner%")
    .in("membership_status", ACTIVE_STATUSES);

  const orgsToProcess: { id: string; name: string; groupId: number }[] = [];

  for (const org of activePartnerOrgs ?? []) {
    if (org.circle_access_group_id) {
      orgsToProcess.push({ id: org.id, name: org.name, groupId: Number(org.circle_access_group_id) });
    }
  }

  if (groupIds.member) {
    for (const org of activeMemberOrgs ?? []) {
      orgsToProcess.push({ id: org.id, name: org.name, groupId: groupIds.member! });
    }
  }

  for (const org of orgsToProcess) {
    const { data: contacts, error: contactsErr } = await adminClient
      .from("contacts")
      .select("id, email, circle_id")
      .eq("organization_id", org.id)
      .not("email", "is", null)
      .not("circle_id", "is", null); // only linked contacts

    if (contactsErr || !contacts) continue;

    for (const contact of contacts) {
      if (!contact.email) continue;
      if (!dryRun) {
        await enqueueCircleSync({
          operation: "add_to_access_group",
          entityType: "contact",
          entityId: contact.id,
          payload: { groupId: org.groupId, email: contact.email },
          orgId: org.id,
          idempotencyKey: `backfill-access-${contact.id}-${org.groupId}`,
        });
      }
      results.contactsQueued++;
    }
  }

  return NextResponse.json(results);
}
