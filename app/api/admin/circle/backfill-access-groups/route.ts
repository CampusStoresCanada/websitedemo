import { NextRequest, NextResponse } from "next/server";
import { getServerAuthState } from "@/lib/auth/server";
import { getCircleClient } from "@/lib/circle/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueCircleSync } from "@/lib/circle/sync";
import { getAccessGroupIds } from "@/lib/circle/config";
import { hasNonMemberTag } from "@/lib/contacts/tags";

export const maxDuration = 60;

const ACTIVE_STATUSES = ["active", "grace", "reactivated"] as const;

/**
 * Reconcile the shared Circle access groups against the database.
 *
 * Every active Member org's contacts belong in the shared "CSC Members" group
 * and every active Vendor Partner org's contacts belong in the shared
 * "Partners" group. Dedicated per-org partner groups were rolled back
 * 2026-08-05; `organizations.circle_access_group_id` is legacy and is
 * deliberately not read here. An earlier version of this route mapped orgs to
 * per-org groups by name and added people to *those*, which is why partners
 * could be provisioned into Circle and still not hold Partners access.
 *
 * API cost: this reads each group's roster once (one call per 100 members,
 * so ~2 calls for Partners today) and then queues an add only for the people
 * who are genuinely absent. Queuing the whole eligible roster instead would
 * cost one Circle write per person — several hundred calls to fix dozens of
 * rows. Pass `limit` to cap the queue size on a first cautious run.
 *
 * POST body:
 *   dryRun?: boolean  — default true; report the diff without queuing
 *   scope?: "partner" | "member" | "all"  — default "all"
 *   limit?: number    — max adds to queue per group this run (default: no cap)
 */
export async function POST(request: NextRequest) {
  const auth = await getServerAuthState();
  if (!auth.user || auth.globalRole !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const client = getCircleClient();
  if (!client) {
    return NextResponse.json({ error: "Circle not configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    dryRun?: boolean;
    scope?: "partner" | "member" | "all";
    limit?: number;
  };
  const dryRun = body.dryRun !== false; // default to dry run
  const scope = body.scope ?? "all";
  const limit =
    typeof body.limit === "number" && body.limit > 0 ? body.limit : null;

  const adminClient = createAdminClient();
  const groupIds = getAccessGroupIds();

  const tiers: { tier: "partner" | "member"; groupId: number | null }[] = [
    { tier: "partner", groupId: groupIds.partner },
    { tier: "member", groupId: groupIds.member },
  ].filter((t) => scope === "all" || scope === t.tier) as {
    tier: "partner" | "member";
    groupId: number | null;
  }[];

  const results = {
    dryRun,
    scope,
    limit,
    tiers: [] as Record<string, unknown>[],
    errors: [] as string[],
  };

  for (const { tier, groupId } of tiers) {
    if (!groupId) {
      results.errors.push(
        `No Circle access group configured for ${tier} — set CIRCLE_${tier.toUpperCase()}_ACCESS_GROUP_ID`
      );
      continue;
    }

    // ── The eligible set, from the database ─────────────────────────────────
    // Partner orgs are every type containing "partner" (today: "Vendor
    // Partner"); member orgs are everything else that carries an active
    // membership status. Org type is capitalized in the DB, hence ilike.
    let orgQuery = adminClient
      .from("organizations")
      .select("id, name, type")
      .in("membership_status", ACTIVE_STATUSES)
      .is("archived_at", null);

    orgQuery =
      tier === "partner"
        ? orgQuery.ilike("type", "%partner%")
        : orgQuery.not("type", "ilike", "%partner%");

    const { data: orgs, error: orgsErr } = await orgQuery;

    if (orgsErr) {
      results.errors.push(`Failed to fetch ${tier} orgs: ${orgsErr.message}`);
      continue;
    }
    if (!orgs?.length) {
      results.tiers.push({ tier, groupId, orgs: 0, eligible: 0, missing: 0, queued: 0 });
      continue;
    }

    const orgById = new Map(orgs.map((o) => [o.id, o.name]));

    // Only contacts already linked to Circle can be added to a group — an
    // add addresses the member by email and 404s if no account exists.
    // Unlinked contacts are a link_member problem, not a group problem.
    const { data: contacts, error: contactsErr } = await adminClient
      .from("contacts")
      .select("id, email, circle_id, contact_type, organization_id")
      .in("organization_id", [...orgById.keys()])
      .is("archived_at", null)
      .not("email", "is", null)
      .not("circle_id", "is", null);

    if (contactsErr) {
      results.errors.push(`Failed to fetch ${tier} contacts: ${contactsErr.message}`);
      continue;
    }

    const eligible = (contacts ?? []).filter(
      (c) => c.email && !hasNonMemberTag(c.contact_type)
    );

    // ── What Circle actually holds, read once ───────────────────────────────
    let rosterIds: number[];
    try {
      rosterIds = await client.listAccessGroupMemberIds(groupId);
    } catch (err) {
      results.errors.push(
        `Failed to read ${tier} group ${groupId} roster: ${err instanceof Error ? err.message : err}`
      );
      continue;
    }
    const roster = new Set(rosterIds.map(String));

    const missing = eligible.filter((c) => !roster.has(String(c.circle_id)));

    // ── Queue an add only for the people genuinely absent ───────────────────
    const toQueue = limit ? missing.slice(0, limit) : missing;
    let queued = 0;

    if (!dryRun) {
      for (const contact of toQueue) {
        await enqueueCircleSync({
          operation: "add_to_access_group",
          entityType: "contact",
          entityId: contact.id,
          payload: { groupId, email: contact.email },
          orgId: contact.organization_id ?? undefined,
          // Stable key: re-running the backfill never double-queues a person,
          // so a partial run is safe to repeat.
          idempotencyKey: `backfill-access-v2-${contact.id}-${groupId}`,
        });
        queued++;
      }
    }

    results.tiers.push({
      tier,
      groupId,
      orgs: orgById.size,
      rosterSize: rosterIds.length,
      eligible: eligible.length,
      alreadyInGroup: eligible.length - missing.length,
      missing: missing.length,
      queued: dryRun ? 0 : queued,
      // Named so a dry run is reviewable before anything is written.
      missingByOrg: Object.entries(
        missing.reduce<Record<string, number>>((acc, c) => {
          const name = orgById.get(c.organization_id ?? "") ?? "(unknown org)";
          acc[name] = (acc[name] ?? 0) + 1;
          return acc;
        }, {})
      )
        .sort((a, b) => b[1] - a[1])
        .map(([org, count]) => ({ org, count })),
      skippedByLimit: missing.length - toQueue.length,
    });
  }

  return NextResponse.json(results);
}
