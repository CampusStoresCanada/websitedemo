#!/usr/bin/env node
/**
 * sync-notion-fte.mjs
 *
 * One-way sync: reads the "FTE" number property from every org page in the
 * Notion Organization DB and writes it to organizations.fte in Supabase.
 *
 * Only updates rows where:
 *   - Notion FTE is a positive number
 *   - The Notion page can be matched to an existing non-archived Supabase org
 *
 * Dry-run by default. Run with --apply to write.
 *
 * Usage:
 *   node scripts/sync-notion-fte.mjs
 *   node scripts/sync-notion-fte.mjs --apply
 *
 * Required env:
 *   NOTION_API_KEY
 *   NOTION_ORG_DB_ID
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const NOTION_VERSION = "2022-06-28";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");

const requiredEnv = [
  "NOTION_API_KEY",
  "NOTION_ORG_DB_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

const notionApiKey = process.env.NOTION_API_KEY;
const notionDbId = process.env.NOTION_ORG_DB_ID;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Notion helpers ────────────────────────────────────────────────────────

function getTitle(props, key) {
  const field = props?.[key];
  if (!field || field.type !== "title") return "";
  return (field.title ?? []).map((t) => t.plain_text ?? "").join("").trim();
}

function getNumber(props, key) {
  const field = props?.[key];
  if (!field || field.type !== "number") return null;
  return typeof field.number === "number" ? field.number : null;
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Notion pagination ─────────────────────────────────────────────────────

async function notionQueryAllOrgPages() {
  const results = [];
  let startCursor = undefined;

  while (true) {
    const body = { page_size: 100 };
    if (startCursor) body.start_cursor = startCursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${notionDbId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionApiKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion query failed (${res.status}): ${text}`);
    }

    const json = await res.json();
    results.push(...(json.results ?? []));
    if (!json.has_more || !json.next_cursor) break;
    startCursor = json.next_cursor;
  }

  return results;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  // 1. Fetch all Notion org pages
  const notionPages = await notionQueryAllOrgPages();
  console.log(`Notion pages fetched: ${notionPages.length}`);

  // 2. Extract name + FTE; skip pages with no FTE value
  const notionOrgs = notionPages
    .map((page) => {
      const props = page.properties ?? {};
      const name = getTitle(props, "Organization");
      const fte = getNumber(props, "FTE");
      return { name, fte };
    })
    .filter((row) => row.name && row.fte != null && row.fte > 0);

  console.log(`Pages with a positive FTE value: ${notionOrgs.length}`);

  // 3. Load all non-archived orgs from Supabase
  const { data: existingRows, error: existingError } = await supabase
    .from("organizations")
    .select("id, name, slug, fte")
    .eq("type", "Member")
    .eq("membership_status", "active")
    .is("archived_at", null);

  if (existingError) {
    throw new Error(`Failed to load organizations: ${existingError.message}`);
  }

  // Build lookup maps
  const bySlug = new Map();
  const byName = new Map();
  for (const row of existingRows ?? []) {
    if (row.slug) bySlug.set(normalizeText(row.slug), row);
    if (row.name && !byName.has(normalizeText(row.name))) byName.set(normalizeText(row.name), row);
  }

  // 4. Match Notion pages to Supabase rows and build update list
  const updates = [];
  const unmatched = [];

  for (const item of notionOrgs) {
    const nameKey = normalizeText(item.name);
    // Try slug-derived from name first, then name lookup
    const slugKey = nameKey.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const existing = bySlug.get(slugKey) ?? byName.get(nameKey) ?? null;

    if (!existing) {
      unmatched.push(item.name);
      continue;
    }

    // Only queue an update if the value is actually changing
    if (existing.fte === item.fte) continue;

    updates.push({
      id: existing.id,
      name: existing.name,
      currentFte: existing.fte,
      newFte: item.fte,
    });
  }

  // 5. Report
  console.log(`\nMatched with FTE changes: ${updates.length}`);
  if (updates.length > 0) {
    console.log("\nPlanned updates:");
    for (const u of updates) {
      console.log(`  ${u.name}: ${u.currentFte ?? "(null)"} → ${u.newFte}`);
    }
  }

  if (unmatched.length > 0) {
    console.log(`\nUnmatched Notion orgs (${unmatched.length}):`);
    for (const name of unmatched) console.log(`  - ${name}`);
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write changes.");
    return;
  }

  // 6. Apply updates one-by-one for clear error attribution
  let successCount = 0;
  let errorCount = 0;

  for (const update of updates) {
    const { error } = await supabase
      .from("organizations")
      .update({ fte: update.newFte, updated_at: new Date().toISOString() })
      .eq("id", update.id);

    if (error) {
      console.error(`  ERROR updating ${update.name}: ${error.message}`);
      errorCount++;
    } else {
      successCount++;
    }
  }

  console.log(`\nApply complete: ${successCount} updated, ${errorCount} errors.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
