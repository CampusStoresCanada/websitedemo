#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const DEFAULT_TABLES = [
  "contacts",
  "user_organizations",
  "brand_colors",
  "conference_people",
  "conference_registrations",
  "conference_orders",
  "cart_items",
  "wishlist_intents",
  "wishlist_billing_attempts",
  "conference_entitlement_assignment_events",
  "membership_assessments",
  "benchmarking_promotions",
];

function parseArgs(argv) {
  const out = {
    sourceId: null,
    targetId: null,
    apply: false,
    archiveSource: true,
    tables: [...DEFAULT_TABLES],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source-id") out.sourceId = argv[i + 1] ?? null;
    if (arg === "--target-id") out.targetId = argv[i + 1] ?? null;
    if (arg === "--apply") out.apply = true;
    if (arg === "--no-archive-source") out.archiveSource = false;
    if (arg === "--tables") {
      const raw = argv[i + 1] ?? "";
      out.tables = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  return out;
}

function assertEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

async function fetchOrg(db, id) {
  const { data, error } = await db
    .from("organizations")
    .select("id,name,slug,membership_status,archived_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed loading org ${id}: ${error.message}`);
  if (!data) throw new Error(`Organization not found: ${id}`);
  return data;
}

async function summarizeTable(db, table, sourceId, targetId) {
  const { data, error } = await db
    .from(table)
    .select("organization_id")
    .in("organization_id", [sourceId, targetId]);

  if (error) {
    return { table, error: error.message, sourceCount: 0, targetCount: 0 };
  }

  const rows = data ?? [];
  return {
    table,
    sourceCount: rows.filter((r) => r.organization_id === sourceId).length,
    targetCount: rows.filter((r) => r.organization_id === targetId).length,
    error: null,
  };
}

async function moveTable(db, table, sourceId, targetId) {
  const { error } = await db
    .from(table)
    .update({ organization_id: targetId })
    .eq("organization_id", sourceId);
  if (error) {
    return { table, ok: false, error: error.message };
  }
  return { table, ok: true, error: null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sourceId || !args.targetId) {
    throw new Error("Usage: --source-id <uuid> --target-id <uuid> [--apply] [--no-archive-source] [--tables a,b,c]");
  }
  if (args.sourceId === args.targetId) {
    throw new Error("source and target org IDs must be different");
  }

  const supabaseUrl = assertEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRole = assertEnv("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(supabaseUrl, serviceRole);

  const sourceOrg = await fetchOrg(db, args.sourceId);
  const targetOrg = await fetchOrg(db, args.targetId);

  const before = [];
  for (const table of args.tables) {
    before.push(await summarizeTable(db, table, args.sourceId, args.targetId));
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "APPLY" : "DRY_RUN",
        sourceOrg,
        targetOrg,
        archiveSource: args.archiveSource,
        tableSummaryBefore: before,
      },
      null,
      2
    )
  );

  if (!args.apply) return;

  const tableMoves = [];
  for (const table of args.tables) {
    tableMoves.push(await moveTable(db, table, args.sourceId, args.targetId));
  }

  let archiveResult = { ok: true, error: null };
  if (args.archiveSource) {
    const now = new Date().toISOString();
    const { error } = await db
      .from("organizations")
      .update({ archived_at: now, updated_at: now })
      .eq("id", args.sourceId);
    if (error) archiveResult = { ok: false, error: error.message };
  }

  const after = [];
  for (const table of args.tables) {
    after.push(await summarizeTable(db, table, args.sourceId, args.targetId));
  }

  console.log(
    JSON.stringify(
      {
        mode: "APPLY",
        tableMoves,
        archiveResult,
        tableSummaryAfter: after,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

