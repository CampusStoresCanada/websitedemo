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
 * Statuses that mean the org has lapsed and its people belong in the shared
 * downgrade group instead of the paid one. Mirrors the `isDeactivated` branch
 * of enqueueOrgCircleAccessSync exactly — `applied`/`approved` orgs are
 * deliberately NOT here. A prospect mid-application is not a lapsed member,
 * and sweeping them into "Non-Member" would label them as one.
 */
const LAPSED_STATUSES = ["locked", "canceled"] as const;

/** PostgREST rejects an `.in()` list past roughly 200 ids with a 400. */
const IN_CHUNK = 150;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type ContactRow = {
  id: string;
  email: string | null;
  circle_id: string | number | null;
  contact_type: string[] | null;
  organization_id: string | null;
};

/** Per-org counts, biggest first — the shape a dry run is reviewed in. */
function byOrg(
  contacts: ContactRow[],
  orgById: Map<string, string>
): { org: string; count: number }[] {
  return Object.entries(
    contacts.reduce<Record<string, number>>((acc, c) => {
      const name = orgById.get(c.organization_id ?? "") ?? "(unknown org)";
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .map(([org, count]) => ({ org, count }));
}

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
 * Both directions are reconciled, because drift happens both ways:
 *
 *   active orgs  → eligible people absent from the paid group get an add
 *   lapsed orgs  → people still holding the paid group get a remove, and
 *                  people absent from the shared downgrade group get an add
 *
 * The lapsed half exists because the live path never ran it. The downgrade-add
 * in enqueueOrgCircleAccessSync is gated on `lapsedGroupId`, so with
 * CIRCLE_NON_MEMBER_ACCESS_GROUP_ID / CIRCLE_NON_PARTNER_ACCESS_GROUP_ID unset
 * the remove fired and the add silently did not: as of 2026-10-08 there were
 * zero add_to_access_group rows for either downgrade group in the whole queue
 * history and both groups were empty in Circle, while 112 removes from CSC
 * Members and 77 from Partners had completed. Everyone the pipeline ever
 * deactivated was stripped and landed in no group at all — losing the
 * Announcements and Partner Bulletin access a lapsed store is meant to keep.
 * Set both env vars before running with dryRun:false or the lapsed half
 * reports and does nothing.
 *
 * API cost: one roster read per group per tier (one call per 100 members), and
 * then a queued write only for the people who are genuinely on the wrong side.
 * Queuing the whole eligible roster instead would cost one Circle write per
 * person — several hundred calls to fix dozens of rows. Pass `limit` to cap
 * the queue size per phase on a first cautious run.
 *
 * POST body:
 *   dryRun?: boolean  — default true; report the diff without queuing
 *   scope?: "partner" | "member" | "all"  — default "all"
 *   direction?: "active" | "lapsed" | "both"  — default "both"
 *   limit?: number    — max writes to queue per phase per tier (default: none)
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
    direction?: "active" | "lapsed" | "both";
    limit?: number;
  };
  const dryRun = body.dryRun !== false; // default to dry run
  const scope = body.scope ?? "all";
  const direction = body.direction ?? "both";
  const doActive = direction === "both" || direction === "active";
  const doLapsed = direction === "both" || direction === "lapsed";
  const limit =
    typeof body.limit === "number" && body.limit > 0 ? body.limit : null;

  const adminClient = createAdminClient();
  const groupIds = getAccessGroupIds();

  const tiers: {
    tier: "partner" | "member";
    groupId: number | null;
    lapsedGroupId: number | null;
  }[] = [
    { tier: "partner", groupId: groupIds.partner, lapsedGroupId: groupIds.nonPartner },
    { tier: "member", groupId: groupIds.member, lapsedGroupId: groupIds.nonMember },
  ].filter((t) => scope === "all" || scope === t.tier) as {
    tier: "partner" | "member";
    groupId: number | null;
    lapsedGroupId: number | null;
  }[];

  const results = {
    dryRun,
    scope,
    direction,
    limit,
    tiers: [] as Record<string, unknown>[],
    errors: [] as string[],
  };

  // Every circle_id we know about, regardless of org or tier. Used only to
  // report how much of a roster this reconciler cannot speak for: a Circle
  // account nothing in `contacts` claims is invisible to every branch below,
  // and a run that silently ignored them would read as "fully reconciled".
  const allKnownCircleIds = new Set<string>();
  {
    const { data: known, error: knownErr } = await adminClient
      .from("contacts")
      .select("circle_id")
      .not("circle_id", "is", null);
    if (knownErr) {
      results.errors.push(`Failed to fetch known circle ids: ${knownErr.message}`);
    } else {
      for (const row of known ?? []) {
        if (row.circle_id) allKnownCircleIds.add(String(row.circle_id));
      }
    }
  }

  for (const { tier, groupId, lapsedGroupId } of tiers) {
    if (!groupId) {
      results.errors.push(
        `No Circle access group configured for ${tier} — set CIRCLE_${tier.toUpperCase()}_ACCESS_GROUP_ID`
      );
      continue;
    }

    // ── What Circle actually holds, read once ───────────────────────────────
    // Read before either phase: the active phase needs it to find who is
    // absent, and the lapsed phase needs the same roster to find who is still
    // present and should not be.
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

    const tierResult: Record<string, unknown> = {
      tier,
      groupId,
      rosterSize: rosterIds.length,
      // Accounts in the paid group that no contact row claims. Nothing here
      // can act on them; they are reported so the run is not mistaken for a
      // complete reconciliation of the group.
      rosterNotAttributed: rosterIds.filter(
        (id) => !allKnownCircleIds.has(String(id))
      ).length,
    };

    // ── Direction 1: active orgs missing their paid group ───────────────────
    if (doActive) {
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
      } else {
        const orgById = new Map((orgs ?? []).map((o) => [o.id, o.name]));

        // Only contacts already linked to Circle can be added to a group — an
        // add addresses the member by email and 404s if no account exists.
        // Unlinked contacts are a link_member problem, not a group problem.
        const contacts: ContactRow[] = [];
        let contactsFailed = false;
        for (const ids of chunk([...orgById.keys()], IN_CHUNK)) {
          const { data, error } = await adminClient
            .from("contacts")
            .select("id, email, circle_id, contact_type, organization_id")
            .in("organization_id", ids)
            .is("archived_at", null)
            .not("email", "is", null)
            .not("circle_id", "is", null);
          if (error) {
            results.errors.push(`Failed to fetch ${tier} contacts: ${error.message}`);
            contactsFailed = true;
            break;
          }
          contacts.push(...((data ?? []) as ContactRow[]));
        }

        if (!contactsFailed) {
          const eligible = contacts.filter(
            (c) => c.email && !hasNonMemberTag(c.contact_type)
          );
          const missing = eligible.filter((c) => !roster.has(String(c.circle_id)));

          // ── Queue an add only for the people genuinely absent ────────────
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
                // Stable key: re-running the backfill never double-queues a
                // person, so a partial run is safe to repeat.
                idempotencyKey: `backfill-access-v2-${contact.id}-${groupId}`,
              });
              queued++;
            }
          }

          Object.assign(tierResult, {
            orgs: orgById.size,
            eligible: eligible.length,
            alreadyInGroup: eligible.length - missing.length,
            missing: missing.length,
            queued: dryRun ? 0 : queued,
            // Named so a dry run is reviewable before anything is written.
            missingByOrg: byOrg(missing, orgById),
            skippedByLimit: missing.length - toQueue.length,
          });
        }
      }
    }

    // ── Direction 2: lapsed orgs — off the paid group, into the downgrade ───
    if (doLapsed) {
      tierResult.lapsed = await reconcileLapsed({
        adminClient,
        client,
        tier,
        paidGroupId: groupId,
        lapsedGroupId,
        paidRoster: roster,
        dryRun,
        limit,
        errors: results.errors,
      });
    }

    results.tiers.push(tierResult);
  }

  return NextResponse.json(results);
}

/**
 * The lapsed half: take people whose org has lapsed off the paid access group
 * and put them in the shared downgrade group, which grants Announcements and
 * the Partner Bulletin and nothing else.
 *
 * Two deliberate refusals:
 *
 *  - With no downgrade group configured this reports and writes NOTHING, not
 *    even the removes. Stripping someone without a destination is the exact
 *    failure this route exists to repair — Announcements is private and hidden
 *    from non-members, so a stripped person with no group loses it.
 *
 *  - Contacts with no `circle_id` are counted and skipped. There is no account
 *    to move, and minting one so a lapsed store can read Announcements is a
 *    reachability decision for a human, not a side effect of a backfill.
 */
async function reconcileLapsed(args: {
  adminClient: ReturnType<typeof createAdminClient>;
  client: NonNullable<ReturnType<typeof getCircleClient>>;
  tier: "partner" | "member";
  paidGroupId: number;
  lapsedGroupId: number | null;
  paidRoster: Set<string>;
  dryRun: boolean;
  limit: number | null;
  errors: string[];
}): Promise<Record<string, unknown>> {
  const {
    adminClient,
    client,
    tier,
    paidGroupId,
    lapsedGroupId,
    paidRoster,
    dryRun,
    limit,
    errors,
  } = args;

  const envVar =
    tier === "partner"
      ? "CIRCLE_NON_PARTNER_ACCESS_GROUP_ID"
      : "CIRCLE_NON_MEMBER_ACCESS_GROUP_ID";

  if (!lapsedGroupId) {
    errors.push(
      `No Circle downgrade group configured for ${tier} — set ${envVar}. ` +
        `Refusing to strip paid access with nowhere to put people.`
    );
    return { configured: false, envVar };
  }

  // ── Lapsed orgs for this tier ────────────────────────────────────────────
  let orgQuery = adminClient
    .from("organizations")
    .select("id, name, type, archived_at")
    .in("membership_status", LAPSED_STATUSES);

  orgQuery =
    tier === "partner"
      ? orgQuery.ilike("type", "%partner%")
      : orgQuery.not("type", "ilike", "%partner%");

  const { data: lapsedOrgs, error: orgsErr } = await orgQuery;
  if (orgsErr) {
    errors.push(`Failed to fetch lapsed ${tier} orgs: ${orgsErr.message}`);
    return { configured: true, lapsedGroupId, error: orgsErr.message };
  }

  // Archived orgs are retired records, not lapsed members. They are reported
  // and left alone: "move them to Announcements" is a statement about a store
  // that still exists.
  const live = (lapsedOrgs ?? []).filter((o) => !o.archived_at);
  const archived = (lapsedOrgs ?? []).filter((o) => o.archived_at);
  const orgById = new Map(live.map((o) => [o.id, o.name]));

  if (orgById.size === 0) {
    return {
      configured: true,
      lapsedGroupId,
      lapsedOrgs: 0,
      archivedOrgsSkipped: archived.length,
    };
  }

  // ── Their people ─────────────────────────────────────────────────────────
  const contacts: ContactRow[] = [];
  for (const ids of chunk([...orgById.keys()], IN_CHUNK)) {
    const { data, error } = await adminClient
      .from("contacts")
      .select("id, email, circle_id, contact_type, organization_id")
      .in("organization_id", ids)
      .is("archived_at", null)
      .not("email", "is", null);
    if (error) {
      errors.push(`Failed to fetch lapsed ${tier} contacts: ${error.message}`);
      return { configured: true, lapsedGroupId, error: error.message };
    }
    contacts.push(...((data ?? []) as ContactRow[]));
  }

  const withAccount = contacts.filter((c) => c.circle_id !== null && c.email);
  const noCircleAccount = contacts.length - withAccount.length;

  // ── What the downgrade group already holds ────────────────────────────────
  let lapsedRosterIds: number[];
  try {
    lapsedRosterIds = await client.listAccessGroupMemberIds(lapsedGroupId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to read ${tier} downgrade group ${lapsedGroupId}: ${message}`);
    return { configured: true, lapsedGroupId, error: message };
  }
  const lapsedRoster = new Set(lapsedRosterIds.map(String));

  // Still holding paid access they are no longer entitled to. No contact_type
  // filter here: whatever a person is tagged as, if they hold the paid group
  // and their org has lapsed, they come out.
  const toStrip = withAccount.filter((c) => paidRoster.has(String(c.circle_id)));

  // Absent from the downgrade group. Also no contact_type filter — the
  // non-member tags exist to stop us *provisioning* accounts, and everyone
  // here already has one. Filtering on the `lapsed` tag in particular would
  // skip exactly the people this is for.
  const toDowngrade = withAccount.filter((c) => !lapsedRoster.has(String(c.circle_id)));

  const stripBatch = limit ? toStrip.slice(0, limit) : toStrip;
  const downgradeBatch = limit ? toDowngrade.slice(0, limit) : toDowngrade;

  let stripQueued = 0;
  let downgradeQueued = 0;

  if (!dryRun) {
    // Downgrade first, strip second. The queue processes in created_at order,
    // so this order means nobody sits in the window between losing the paid
    // group and gaining Announcements.
    for (const contact of downgradeBatch) {
      await enqueueCircleSync({
        operation: "add_to_access_group",
        entityType: "contact",
        entityId: contact.id,
        payload: { groupId: lapsedGroupId, email: contact.email },
        orgId: contact.organization_id ?? undefined,
        // Stable, so a repeat run is a no-op. The live transition path keys
        // its own removes with a timestamp, so a genuine re-lapse later still
        // queues through enqueueOrgCircleAccessSync regardless of this key.
        idempotencyKey: `backfill-lapsed-add-v1-${contact.id}-${lapsedGroupId}`,
      });
      downgradeQueued++;
    }
    for (const contact of stripBatch) {
      await enqueueCircleSync({
        operation: "remove_from_access_group",
        entityType: "contact",
        entityId: contact.id,
        payload: { groupId: paidGroupId, email: contact.email },
        orgId: contact.organization_id ?? undefined,
        idempotencyKey: `backfill-lapsed-strip-v1-${contact.id}-${paidGroupId}`,
      });
      stripQueued++;
    }
  }

  return {
    configured: true,
    lapsedGroupId,
    lapsedOrgs: orgById.size,
    archivedOrgsSkipped: archived.length,
    contacts: contacts.length,
    withCircleAccount: withAccount.length,
    noCircleAccount,
    holdingPaidAccess: toStrip.length,
    stripQueued: dryRun ? 0 : stripQueued,
    alreadyInDowngradeGroup: withAccount.length - toDowngrade.length,
    missingFromDowngradeGroup: toDowngrade.length,
    downgradeQueued: dryRun ? 0 : downgradeQueued,
    downgradeGroupRosterSize: lapsedRosterIds.length,
    stripByOrg: byOrg(toStrip, orgById),
    downgradeByOrg: byOrg(toDowngrade, orgById),
    skippedByLimit: {
      strip: toStrip.length - stripBatch.length,
      downgrade: toDowngrade.length - downgradeBatch.length,
    },
  };
}
