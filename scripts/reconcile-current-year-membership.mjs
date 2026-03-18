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
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const RENAME_RULES = [
  {
    notionName: "Ambrose University Lions' Store",
    preferredExistingSlug: "ambrose-university-college-bookstores",
    desiredSlug: "ambrose-university-lions-store",
  },
];

function normalize(value) {
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

async function queryNotionTagged() {
  const results = [];
  let cursor;

  const filter = {
    or: [
      { property: "Tag", relation: { contains: MEMBER_TAG_ID } },
      { property: "Tag", relation: { contains: PARTNER_TAG_ID } },
    ],
  };

  while (true) {
    const body = { filter, page_size: 100 };
    if (cursor) body.start_cursor = cursor;

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
      throw new Error(`Notion query failed (${res.status}): ${await res.text()}`);
    }

    const json = await res.json();
    results.push(...(json.results ?? []));

    if (!json.has_more || !json.next_cursor) break;
    cursor = json.next_cursor;
  }

  return results;
}

function targetTypeFor(tags, notionOrgType) {
  const hasMember = tags.includes(MEMBER_TAG_ID);
  const hasPartner = tags.includes(PARTNER_TAG_ID);

  if (hasMember && !hasPartner) return "Member";
  if (hasPartner && !hasMember) return "Vendor Partner";
  if (hasMember && hasPartner) {
    if (notionOrgType === "Member" || notionOrgType === "Vendor Partner") return notionOrgType;
  }
  return null;
}

function pickMatch(item, bySlug, byName) {
  const renameRule = RENAME_RULES.find((r) => normalize(r.notionName) === normalize(item.name));
  if (renameRule) {
    const preferred = bySlug.get(normalize(renameRule.preferredExistingSlug));
    if (preferred) return { row: preferred, renameRule };
  }

  const exactSlug = bySlug.get(normalize(item.slug));
  if (exactSlug) return { row: exactSlug, renameRule: null };

  const exactName = byName.get(normalize(item.name));
  if (exactName) return { row: exactName, renameRule: null };

  return { row: null, renameRule: renameRule ?? null };
}

function ensureUniqueSlug(base, usedSlugs) {
  let slug = base;
  let i = 2;
  while (usedSlugs.has(normalize(slug))) {
    slug = `${base}-${i}`;
    i += 1;
  }
  usedSlugs.add(normalize(slug));
  return slug;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  const notionPages = await queryNotionTagged();
  console.log(`Notion tagged org pages fetched: ${notionPages.length}`);

  const tagged = notionPages
    .map((page) => {
      const props = page.properties ?? {};
      const name = getTitle(props, "Organization");
      const tagIds = getRelationIds(props, "Tag");
      const normalizedTags = tagIds.map((id) => {
        if (id === MEMBER_TAG_ID || id === PARTNER_TAG_ID) return id;
        const lower = id.toLowerCase();
        if (lower === MEMBER_TAG_ID.replace(/-/g, "")) return MEMBER_TAG_ID;
        if (lower === PARTNER_TAG_ID.replace(/-/g, "")) return PARTNER_TAG_ID;
        return id;
      });

      const notionOrgType = getSelect(props, "Organization Type");
      const targetType = targetTypeFor(normalizedTags, notionOrgType);
      if (!name || !targetType) return null;

      return {
        notionPageId: page.id,
        name,
        slug: slugify(name),
        city: getRichText(props, "City"),
        province: getSelect(props, "Province"),
        website: getUrl(props, "Website"),
        primaryCategory: getSelect(props, "Primary Category"),
        targetType,
      };
    })
    .filter(Boolean);

  const { data: rows, error } = await supabase
    .from("organizations")
    .select("id,tenant_id,name,slug,type,membership_status,archived_at,city,province,website,primary_category")
    .is("archived_at", null);

  if (error) throw new Error(`Failed to load organizations: ${error.message}`);
  if (!rows?.length) throw new Error("No organizations found.");

  const tenantId = rows[0].tenant_id;
  const bySlug = new Map();
  const byName = new Map();
  const usedSlugs = new Set();

  for (const row of rows) {
    if (row.slug) {
      bySlug.set(normalize(row.slug), row);
      usedSlugs.add(normalize(row.slug));
    }
    if (row.name && !byName.has(normalize(row.name))) {
      byName.set(normalize(row.name), row);
    }
  }

  const updates = [];
  const inserts = [];
  const keepActiveIds = new Set();
  const archiveRows = [];

  for (const item of tagged) {
    const { row, renameRule } = pickMatch(item, bySlug, byName);

    if (!row) {
      const slug = ensureUniqueSlug(item.slug, usedSlugs);
      const id = crypto.randomUUID();
      inserts.push({
        id,
        tenant_id: tenantId,
        name: item.name,
        slug,
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
      keepActiveIds.add(id);
      continue;
    }

    const patch = {};
    if (row.type !== item.targetType) patch.type = item.targetType;
    if (row.membership_status !== "active") patch.membership_status = "active";
    if (row.archived_at !== null) patch.archived_at = null;
    if (!row.city && item.city) patch.city = item.city;
    if (!row.province && item.province) patch.province = item.province;
    if (!row.website && item.website) patch.website = item.website;
    if (item.targetType === "Vendor Partner" && !row.primary_category && item.primaryCategory) {
      patch.primary_category = item.primaryCategory;
    }

    if (renameRule) {
      const desiredSlug = renameRule.desiredSlug;
      const desiredSlugKey = normalize(desiredSlug);
      const slugConflict = bySlug.get(desiredSlugKey);

      if (slugConflict && slugConflict.id !== row.id) {
        const archivedSlug = ensureUniqueSlug(`${slugConflict.slug}-archived`, usedSlugs);
        archiveRows.push({
          id: slugConflict.id,
          name: slugConflict.name,
          patch: {
            membership_status: "canceled",
            archived_at: new Date().toISOString(),
            slug: archivedSlug,
            updated_at: new Date().toISOString(),
          },
        });
        bySlug.delete(desiredSlugKey);
      }

      if (row.name !== item.name) patch.name = item.name;
      if (row.slug !== desiredSlug) patch.slug = desiredSlug;
    }

    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      updates.push({ id: row.id, name: row.name, patch });
    }

    keepActiveIds.add(row.id);
  }

  const activeCandidates = rows.filter(
    (r) =>
      r.archived_at === null &&
      r.membership_status === "active" &&
      (r.type === "Member" || r.type === "Vendor Partner")
  );

  const deactivate = activeCandidates
    .filter((r) => !keepActiveIds.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      patch: {
        membership_status: "canceled",
        updated_at: new Date().toISOString(),
      },
    }));

  const taggedMembers = tagged.filter((t) => t.targetType === "Member").length;
  const taggedPartners = tagged.filter((t) => t.targetType === "Vendor Partner").length;

  console.log(`Tagged considered: ${tagged.length} (members=${taggedMembers}, partners=${taggedPartners})`);
  console.log(`Will update matched rows: ${updates.length}`);
  console.log(`Will insert missing rows: ${inserts.length}`);
  console.log(`Will deactivate non-tagged active rows: ${deactivate.length}`);
  console.log(`Will archive duplicate rename rows: ${archiveRows.length}`);

  const preview = [
    ...archiveRows.slice(0, 5).map((x) => `ARCHIVE ${x.name}`),
    ...updates.slice(0, 10).map((x) => `UPDATE ${x.name}`),
    ...inserts.slice(0, 10).map((x) => `INSERT ${x.name}`),
    ...deactivate.slice(0, 10).map((x) => `DEACTIVATE ${x.name}`),
  ];
  if (preview.length) {
    console.log("Preview:");
    for (const line of preview) console.log(`- ${line}`);
  }

  if (!APPLY) {
    console.log("Dry run complete. Re-run with --apply to write changes.");
    return;
  }

  for (const entry of archiveRows) {
    const { error: e } = await supabase.from("organizations").update(entry.patch).eq("id", entry.id);
    if (e) throw new Error(`Archive failed for ${entry.name}: ${e.message}`);
  }

  for (const entry of updates) {
    const { error: e } = await supabase.from("organizations").update(entry.patch).eq("id", entry.id);
    if (e) throw new Error(`Update failed for ${entry.name}: ${e.message}`);
  }

  if (inserts.length) {
    const { error: e } = await supabase.from("organizations").insert(inserts);
    if (e) throw new Error(`Insert failed: ${e.message}`);
  }

  for (const entry of deactivate) {
    const { error: e } = await supabase.from("organizations").update(entry.patch).eq("id", entry.id);
    if (e) throw new Error(`Deactivate failed for ${entry.name}: ${e.message}`);
  }

  console.log("Apply complete.");
  console.log(`Archived: ${archiveRows.length}`);
  console.log(`Updated: ${updates.length}`);
  console.log(`Inserted: ${inserts.length}`);
  console.log(`Deactivated: ${deactivate.length}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
