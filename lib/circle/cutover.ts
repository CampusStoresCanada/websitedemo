// ---------------------------------------------------------------------------
// Circle Launch Day Auth Cutover — utilities
// ---------------------------------------------------------------------------
// Provides:
//   getCircleCutoverStatus()         — dashboard stats
//   backfillCircleMemberMapping()    — email-match contacts → mapping table
//   setCircleCutoverFlag(key, value) — direct policy flag toggle (kill switch)
//   validateCutoverReadiness()       — pre-flight checks
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleClient } from "./client";
import { isCircleConfigured } from "./config";

// ---------------------------------------------------------------------------
// Status / stats
// ---------------------------------------------------------------------------

export interface CircleCutoverStatus {
  configured: boolean;
  cutoverEnabled: boolean;
  legacyFallbackEnabled: boolean;
  canaryOrgIds: string[];
  stats: {
    totalContacts: number;
    linkedContacts: number;         // have circle_id on contacts table
    mappingEntries: number;         // rows in circle_member_mapping
    verifiedMappings: number;
    recentSyncFailures: number;     // queue items failed in last 24h
    pendingQueueItems: number;
  };
  readiness: {
    ok: boolean;
    issues: string[];
  };
}

export async function getCircleCutoverStatus(): Promise<CircleCutoverStatus> {
  const db = createAdminClient();

  // Read feature flags from policy_values (live values, no cache)
  const { data: flagRows } = await db
    .from("policy_values")
    .select("key, value_json")
    .in("key", [
      "integration.circle_cutover_enabled",
      "integration.circle_canary_org_ids",
      "integration.circle_legacy_fallback_enabled",
    ]);

  const flags = Object.fromEntries(
    (flagRows ?? []).map((r) => [r.key, r.value_json])
  );

  const cutoverEnabled = Boolean(flags["integration.circle_cutover_enabled"]);
  const legacyFallbackEnabled = Boolean(flags["integration.circle_legacy_fallback_enabled"] ?? true);
  const canaryOrgIds = Array.isArray(flags["integration.circle_canary_org_ids"])
    ? (flags["integration.circle_canary_org_ids"] as string[])
    : [];

  // Parallel stats queries
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const [totalRes, linkedRes, mappingRes, verifiedRes, failuresRes, pendingRes] =
    await Promise.all([
      db.from("contacts").select("id", { count: "exact", head: true }),
      db.from("contacts").select("id", { count: "exact", head: true }).not("circle_id", "is", null),
      anyDb.from("circle_member_mapping").select("id", { count: "exact", head: true }),
      anyDb.from("circle_member_mapping").select("id", { count: "exact", head: true }).eq("verified", true),
      anyDb
        .from("circle_sync_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      anyDb
        .from("circle_sync_queue")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "processing"]),
    ]);

  const stats = {
    totalContacts: totalRes.count ?? 0,
    linkedContacts: linkedRes.count ?? 0,
    mappingEntries: mappingRes.count ?? 0,
    verifiedMappings: verifiedRes.count ?? 0,
    recentSyncFailures: failuresRes.count ?? 0,
    pendingQueueItems: pendingRes.count ?? 0,
  };

  const issues: string[] = [];
  if (!isCircleConfigured()) issues.push("Circle API credentials not configured (CIRCLE_API_KEY / CIRCLE_COMMUNITY_ID)");
  if (!process.env.CIRCLE_HEADLESS_AUTH_TOKEN) issues.push("CIRCLE_HEADLESS_AUTH_TOKEN not set — headless auth will fail");
  if (!process.env.CIRCLE_BOT_USER_ID) issues.push("CIRCLE_BOT_USER_ID not set — bot DMs disabled");
  if (!process.env.CIRCLE_WEBHOOK_SECRET) issues.push("CIRCLE_WEBHOOK_SECRET not set — webhooks will be rejected");
  if (stats.linkedContacts === 0) issues.push("No contacts linked to Circle yet — run backfill first");
  if (stats.mappingEntries === 0) issues.push("circle_member_mapping table is empty — run backfill first");
  if (stats.recentSyncFailures > 10) issues.push(`${stats.recentSyncFailures} sync failures in last 24h — investigate before cutover`);

  return {
    configured: isCircleConfigured(),
    cutoverEnabled,
    legacyFallbackEnabled,
    canaryOrgIds,
    stats,
    readiness: {
      ok: issues.length === 0,
      issues,
    },
  };
}

// ---------------------------------------------------------------------------
// Backfill: match contacts → circle_member_mapping by email
// ---------------------------------------------------------------------------

export interface BackfillResult {
  checked: number;
  matched: number;
  created: number;
  skipped: number;
  errors: string[];
  dryRun: boolean;
}

/**
 * Scan all contacts with a circle_id and ensure a circle_member_mapping row
 * exists for them. Match method: email (deterministic).
 *
 * Set dryRun=true to preview results without writing anything.
 * Idempotent: safe to re-run; skips existing entries.
 */
export async function backfillCircleMemberMapping(
  options: { dryRun?: boolean; limit?: number } = {}
): Promise<BackfillResult> {
  const { dryRun = false, limit = 500 } = options;
  const result: BackfillResult = {
    checked: 0,
    matched: 0,
    created: 0,
    skipped: 0,
    errors: [],
    dryRun,
  };

  const db = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  // Get contacts that have a circle_id
  const { data: contacts, error } = await db
    .from("contacts")
    .select("id, email, circle_id")
    .not("circle_id", "is", null)
    .limit(limit);

  if (error) {
    result.errors.push(`Failed to fetch contacts: ${error.message}`);
    return result;
  }

  if (!contacts || contacts.length === 0) return result;

  // Get existing mappings to avoid duplicates
  const circleIds = contacts.map((c) => Number(c.circle_id)).filter(Boolean);
  const { data: existing } = await anyDb
    .from("circle_member_mapping")
    .select("circle_member_id")
    .in("circle_member_id", circleIds);

  const existingSet = new Set(
    ((existing ?? []) as Array<{ circle_member_id: number }>).map((r) => r.circle_member_id)
  );

  for (const contact of contacts) {
    result.checked++;
    const circleId = Number(contact.circle_id);
    if (!circleId) continue;

    result.matched++;

    if (existingSet.has(circleId)) {
      result.skipped++;
      continue;
    }

    if (dryRun) {
      result.created++;
      continue;
    }

    const { error: insertErr } = await anyDb.from("circle_member_mapping").insert({
      contact_id: contact.id,
      circle_member_id: circleId,
      match_method: "email",
      match_confidence: "high",
      verified: false,
    });

    if (insertErr) {
      if (insertErr.code === "23505") {
        result.skipped++; // race condition duplicate — safe to skip
      } else {
        result.errors.push(`contact ${contact.id}: ${insertErr.message}`);
      }
    } else {
      result.created++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Feature flag toggle (direct write — bypasses draft system for kill switch)
// ---------------------------------------------------------------------------

export type CircleCutoverFlag =
  | "integration.circle_cutover_enabled"
  | "integration.circle_legacy_fallback_enabled"
  | "integration.circle_canary_org_ids";

/**
 * Directly update a Circle integration feature flag in the active policy set.
 * Bypasses the policy draft/publish workflow intentionally — this is the
 * emergency kill switch path.
 *
 * Only super_admin should call this.
 */
export async function setCircleCutoverFlag(
  key: CircleCutoverFlag,
  value: unknown
): Promise<{ success: boolean; error?: string }> {
  const db = createAdminClient();

  // Get the active policy set
  const { data: policySet, error: psErr } = await db
    .from("policy_sets")
    .select("id")
    .eq("status", "active")
    .limit(1)
    .single();

  if (psErr || !policySet) {
    return { success: false, error: "No active policy set found" };
  }

  const { error } = await db
    .from("policy_values")
    .update({ value_json: value as import("@/lib/database.types").Json })
    .eq("policy_set_id", policySet.id)
    .eq("key", key);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Pre-flight cutover validation
// ---------------------------------------------------------------------------

export interface CutoverValidationResult {
  ok: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
  }>;
}

/**
 * Run all pre-flight checks before enabling Circle cutover.
 * Returns a list of named checks with pass/fail + message.
 */
export async function validateCutoverReadiness(): Promise<CutoverValidationResult> {
  const checks: CutoverValidationResult["checks"] = [];

  // 1. Circle credentials
  checks.push({
    name: "Circle API credentials",
    passed: isCircleConfigured(),
    message: isCircleConfigured()
      ? "CIRCLE_API_KEY and CIRCLE_COMMUNITY_ID are set"
      : "CIRCLE_API_KEY or CIRCLE_COMMUNITY_ID missing",
  });

  // 2. Headless auth token
  const hasHeadlessToken = Boolean(process.env.CIRCLE_HEADLESS_AUTH_TOKEN);
  checks.push({
    name: "Headless auth token",
    passed: hasHeadlessToken,
    message: hasHeadlessToken
      ? "CIRCLE_HEADLESS_AUTH_TOKEN is set"
      : "CIRCLE_HEADLESS_AUTH_TOKEN not set — member proxy will fail",
  });

  // 3. Bot user configured
  const hasBotUser = Boolean(process.env.CIRCLE_BOT_USER_ID);
  checks.push({
    name: "Bot user",
    passed: hasBotUser,
    message: hasBotUser
      ? "CIRCLE_BOT_USER_ID is set"
      : "CIRCLE_BOT_USER_ID not set — bot DMs will fail",
  });

  // 4. Webhook secret
  const hasWebhookSecret = Boolean(process.env.CIRCLE_WEBHOOK_SECRET);
  checks.push({
    name: "Webhook secret",
    passed: hasWebhookSecret,
    message: hasWebhookSecret
      ? "CIRCLE_WEBHOOK_SECRET is set"
      : "CIRCLE_WEBHOOK_SECRET not set — webhooks will be rejected",
  });

  // 5. Circle API connectivity (live ping)
  if (isCircleConfigured()) {
    const circleClient = getCircleClient();
    let apiReachable = false;
    let apiMessage = "Could not reach Circle API";
    try {
      await circleClient!.getCommunity();
      apiReachable = true;
      apiMessage = "Circle API responded successfully";
    } catch (err) {
      apiMessage = `Circle API error: ${err instanceof Error ? err.message : String(err)}`;
    }
    checks.push({ name: "Circle API reachability", passed: apiReachable, message: apiMessage });
  } else {
    checks.push({
      name: "Circle API reachability",
      passed: false,
      message: "Skipped — credentials not configured",
    });
  }

  // 6. Mapping table has entries
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any;

  const { count: mappingCount } = await anyDb
    .from("circle_member_mapping")
    .select("id", { count: "exact", head: true });

  checks.push({
    name: "Member mapping backfill",
    passed: (mappingCount ?? 0) > 0,
    message:
      (mappingCount ?? 0) > 0
        ? `${mappingCount} members in mapping table`
        : "No entries in circle_member_mapping — run backfill first",
  });

  // 7. No runaway queue failures
  const { count: failCount } = await anyDb
    .from("circle_sync_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

  const failThreshold = 5;
  checks.push({
    name: "Sync queue health",
    passed: (failCount ?? 0) <= failThreshold,
    message:
      (failCount ?? 0) <= failThreshold
        ? `${failCount ?? 0} failures in last hour (threshold: ${failThreshold})`
        : `${failCount} failures in last hour — resolve before cutover`,
  });

  return {
    ok: checks.every((c) => c.passed),
    checks,
  };
}
