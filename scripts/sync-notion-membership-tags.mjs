#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const MEMBER_TAG_ID = "218a69bf-0cfd-802f-9f1d-dcdfec0d716f";
const PARTNER_TAG_ID = "20da69bf-0cfd-80c7-89fd-e9739c95976b";
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

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(input) {
  const base = String(input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return base || `org-${crypto.randomUUID().slice(0, 8)}`;
}

function getTitle(props, key) {
  const field = props?.[key];
  if (!field || field.type !== "title") return "";
  return (field.title ?? []).map((t) => t.plain_text ?? "").join("").trim();
}

function getRichText(props, key) {
  const field = props?.[key];
  if (!field || field.type !== "rich_text") return null;
  const value = (field.rich_text ?? []).map((t) => t.plain_text ?? "").join("").trim();
  return value || null;
}

function getSelect(props, key) {
  const field = props?.[key];
  if (!field || field.type !== "select") return null;
  return field.select?.name ?? null;
}

function getUrl(props, key) {
  const field = props?.[key];
  if (!field || field.type !== "url") return null;
  return field.url ?? null;
}

function getRelationIds(props, key) {
  const field = props?.[key];
  if (!field || field.type !== "relation") return [];
  return (field.relation ?? []).map((r) => r.id).filter(Boolean);
}

async function notionQueryTaggedOrgPages() {
  const results = [];
  let startCursor = undefined;

  while (true) {
    const body = {
      filter: {
        or: [
          {
            property: "Tag",
            relation: { contains: MEMBER_TAG_ID.replace(/-/g, "") },
          },
          {
            property: "Tag",
            relation: { contains: PARTNER_TAG_ID.replace(/-/g, "") },
          },
        ],
      },
      page_size: 100,
    };

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

function resolveTargetType(hasMemberTag, hasPartnerTag, notionOrgType) {
  if (hasMemberTag && !hasPartnerTag) return "Member";
  if (hasPartnerTag && !hasMemberTag) return "Vendor Partner";
  if (hasMemberTag && hasPartnerTag) {
    if (notionOrgType === "Member" || notionOrgType === "Vendor Partner") return notionOrgType;
  }
  return null;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  const notionPages = await notionQueryTaggedOrgPages();
  console.log(`Notion tagged org pages fetched: ${notionPages.length}`);

  const tagged = notionPages
    .map((page) => {
      const props = page.properties ?? {};
      const name = getTitle(props, "Organization");
      const tagIds = getRelationIds(props, "Tag");
      const hasMemberTag = tagIds.some((id) => id.replace(/-/g, "") === MEMBER_TAG_ID.replace(/-/g, ""));
      const hasPartnerTag = tagIds.some((id) => id.replace(/-/g, "") === PARTNER_TAG_ID.replace(/-/g, ""));
      const notionOrgType = getSelect(props, "Organization Type");
      const targetType = resolveTargetType(hasMemberTag, hasPartnerTag, notionOrgType);

      return {
        notionPageId: page.id,
        name,
        slug: slugify(name),
        city: getRichText(props, "City"),
        province: getSelect(props, "Province"),
        website: getUrl(props, "Website"),
        primaryCategory: getSelect(props, "Primary Category"),
        hasMemberTag,
        hasPartnerTag,
        notionOrgType,
        targetType,
      };
    })
    .filter((row) => row.name && row.targetType);

  const { data: existingRows, error: existingError } = await supabase
    .from("organizations")
    .select("id,name,slug,type,membership_status,archived_at,tenant_id,city,province,website,primary_category")
    .is("archived_at", null);

  if (existingError) {
    throw new Error(`Failed to load existing organizations: ${existingError.message}`);
  }

  if (!existingRows || existingRows.length === 0) {
    throw new Error("No existing organizations found; cannot infer tenant_id for inserts.");
  }

  const tenantId = existingRows[0].tenant_id;
  const bySlug = new Map();
  const byName = new Map();
  const usedSlugs = new Set();

  for (const row of existingRows) {
    if (row.slug) {
      const key = normalizeText(row.slug);
      bySlug.set(key, row);
      usedSlugs.add(key);
    }
    if (row.name) {
      const key = normalizeText(row.name);
      if (!byName.has(key)) byName.set(key, row);
    }
  }

  const updates = [];
  const inserts = [];
  const skipped = [];

  for (const item of tagged) {
    const slugKey = normalizeText(item.slug);
    const nameKey = normalizeText(item.name);
    const existing = bySlug.get(slugKey) ?? byName.get(nameKey) ?? null;

    if (existing) {
      const patch = {};
      if (existing.type !== item.targetType) patch.type = item.targetType;
      if (existing.membership_status !== "active") patch.membership_status = "active";
      if (existing.archived_at !== null) patch.archived_at = null;

      if (!existing.city && item.city) patch.city = item.city;
      if (!existing.province && item.province) patch.province = item.province;
      if (!existing.website && item.website) patch.website = item.website;
      if (item.targetType === "Vendor Partner" && !existing.primary_category && item.primaryCategory) {
        patch.primary_category = item.primaryCategory;
      }

      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        updates.push({ id: existing.id, name: existing.name, patch, source: item });
      }
      continue;
    }

    let insertSlug = item.slug;
    let counter = 2;
    while (usedSlugs.has(normalizeText(insertSlug))) {
      insertSlug = `${item.slug}-${counter}`;
      counter += 1;
    }
    usedSlugs.add(normalizeText(insertSlug));

    inserts.push({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      name: item.name,
      slug: insertSlug,
      type: item.targetType,
      membership_status: "active",
      archived_at: null,
      city: item.city,
      province: item.province,
      country: "Canada",
      website: item.website,
      primary_category: item.targetType === "Vendor Partner" ? item.primaryCategory : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  for (const item of notionPages) {
    const name = getTitle(item.properties ?? {}, "Organization");
    if (!name) skipped.push(item.id);
  }

  console.log(`Tagged rows considered: ${tagged.length}`);
  console.log(`Will update: ${updates.length}`);
  console.log(`Will insert: ${inserts.length}`);
  console.log(`Skipped (missing title/target type): ${skipped.length}`);

  const previewNames = [
    ...updates.slice(0, 15).map((u) => `UPDATE ${u.name} -> ${u.patch.type ?? "(keep type)"}/${u.patch.membership_status ?? "(keep status)"}`),
    ...inserts.slice(0, 15).map((i) => `INSERT ${i.name} -> ${i.type}/active`),
  ];

  if (previewNames.length > 0) {
    console.log("Preview:");
    for (const line of previewNames) console.log(`- ${line}`);
  }

  if (!APPLY) {
    console.log("Dry run complete. Re-run with --apply to write changes.");
    return;
  }

  for (const update of updates) {
    const { error } = await supabase
      .from("organizations")
      .update(update.patch)
      .eq("id", update.id);
    if (error) {
      throw new Error(`Update failed for ${update.name}: ${error.message}`);
    }
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("organizations").insert(inserts);
    if (error) {
      throw new Error(`Insert failed: ${error.message}`);
    }
  }

  console.log("Apply complete.");
  console.log(`Updated rows: ${updates.length}`);
  console.log(`Inserted rows: ${inserts.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
