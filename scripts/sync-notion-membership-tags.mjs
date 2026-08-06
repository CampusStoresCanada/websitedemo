#!/usr/bin/env node
// Supabase is authoritative. This script reconciles the 25/26 Partner/Member
// tag between Notion and Supabase per-org, keyed on the stable
// organizations.notion_id (never by slug/name — that broke the moment an org
// got renamed or merged, and silently re-inserted duplicate rows every time
// this ran afterward; see the 2026-08-05 incident).
//
// Direction per org is decided by timestamp, not by which side ran last:
//   - If the Notion page's last_edited_time is strictly newer than the
//     Supabase row's updated_at, Notion wins for that org: pull its tag
//     state into Supabase (type + membership_status), matched by notion_id.
//   - Otherwise (Supabase same-age-or-newer, including the common case of an
//     admin fixing something directly in Supabase), Supabase wins: push the
//     org's current type/membership_status onto the Notion page's Tag
//     relation, adding or removing only the 25/26 Partner/Member tag and
//     leaving every other tag on that page untouched.
//
// Never inserts a new Supabase row. A Notion page tagged 25/26 with no
// matching notion_id in Supabase is reported for manual linking, not synced.
import { createClient } from "@supabase/supabase-js";

const MEMBER_TAG_ID = "218a69bf-0cfd-802f-9f1d-dcdfec0d716f";
const PARTNER_TAG_ID = "20da69bf-0cfd-80c7-89fd-e9739c95976b";
const NOTION_VERSION = "2022-06-28";
const TAG_PROPERTY_NAME = "Tag";
const ORG_TITLE_PROPERTY_NAME = "Organization";

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

function normalizeId(id) {
  return String(id ?? "").replace(/-/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function notionFetch(path, options = {}) {
  const res = await fetch(`https://api.notion.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${options.method ?? "GET"} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function notionGetPage(pageId) {
  return notionFetch(`/v1/pages/${pageId}`);
}

async function notionUpdatePageTagRelation(pageId, relationIds) {
  return notionFetch(`/v1/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [TAG_PROPERTY_NAME]: {
          relation: relationIds.map((id) => ({ id })),
        },
      },
    }),
  });
}

async function notionQueryTaggedOrgPages() {
  const results = [];
  let startCursor = undefined;

  while (true) {
    const body = {
      filter: {
        or: [
          { property: TAG_PROPERTY_NAME, relation: { contains: normalizeId(MEMBER_TAG_ID) } },
          { property: TAG_PROPERTY_NAME, relation: { contains: normalizeId(PARTNER_TAG_ID) } },
        ],
      },
      page_size: 100,
      ...(startCursor ? { start_cursor: startCursor } : {}),
    };

    const json = await notionFetch(`/v1/databases/${notionDbId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    results.push(...(json.results ?? []));
    if (!json.has_more || !json.next_cursor) break;
    startCursor = json.next_cursor;
  }

  return results;
}

function getTitle(props, key) {
  const field = props?.[key];
  if (!field || field.type !== "title") return "";
  return (field.title ?? []).map((t) => t.plain_text ?? "").join("").trim();
}

function getRelationIds(props, key) {
  const field = props?.[key];
  if (!field || field.type !== "relation") return [];
  return (field.relation ?? []).map((r) => r.id).filter(Boolean);
}

function hasTag(relationIds, tagId) {
  const target = normalizeId(tagId);
  return relationIds.some((id) => normalizeId(id) === target);
}

/** Member/Vendor Partner, from whichever tag(s) are present. Mirrors the
 * original resolveTargetType: if both tags are somehow present, keep the
 * org's existing type rather than guessing. */
function resolveTargetTypeFromTags(hasMemberTag, hasPartnerTag, existingType) {
  if (hasMemberTag && !hasPartnerTag) return "Member";
  if (hasPartnerTag && !hasMemberTag) return "Vendor Partner";
  if (hasMemberTag && hasPartnerTag) return existingType ?? null;
  return null;
}

/** Does this org's current Supabase state mean it should carry a 25/26 tag,
 * and if so which one? */
function desiredTagForOrg(org) {
  const isCurrentMember = org.membership_status === "active" || org.membership_status === "reactivated";
  if (!isCurrentMember) return null;
  if (org.type === "Member") return MEMBER_TAG_ID;
  if (org.type === "Vendor Partner") return PARTNER_TAG_ID;
  return null;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  const { data: orgs, error: orgsError } = await supabase
    .from("organizations")
    .select("id,name,type,membership_status,notion_id,updated_at,archived_at")
    .is("archived_at", null)
    .not("notion_id", "is", null);

  if (orgsError) throw new Error(`Failed to load organizations: ${orgsError.message}`);

  console.log(`Supabase orgs linked to a Notion page: ${orgs.length}`);

  const pullUpdates = []; // Notion newer -> patch Supabase
  const pushUpdates = []; // Supabase same-or-newer -> patch Notion
  const errors = [];

  for (const org of orgs) {
    let page;
    try {
      page = await notionGetPage(org.notion_id);
    } catch (err) {
      errors.push(`${org.name} (${org.id}): failed to fetch Notion page ${org.notion_id}: ${err.message}`);
      continue;
    }

    const props = page.properties ?? {};
    const relationIds = getRelationIds(props, TAG_PROPERTY_NAME);
    const notionHasMemberTag = hasTag(relationIds, MEMBER_TAG_ID);
    const notionHasPartnerTag = hasTag(relationIds, PARTNER_TAG_ID);

    const notionEditedAt = new Date(page.last_edited_time).getTime();
    const supabaseUpdatedAt = new Date(org.updated_at).getTime();
    const notionIsNewer = notionEditedAt > supabaseUpdatedAt;

    if (notionIsNewer) {
      const targetType = resolveTargetTypeFromTags(notionHasMemberTag, notionHasPartnerTag, org.type);
      const notionSaysActive = notionHasMemberTag || notionHasPartnerTag;
      const patch = {};
      if (targetType && org.type !== targetType) patch.type = targetType;
      if (notionSaysActive && org.membership_status !== "active") patch.membership_status = "active";
      // Notion no longer tags this org for 25/26, and Supabase still thinks
      // it's active — only act on this if Notion's own edit is what dropped
      // the tag (notionIsNewer already established that).
      if (!notionSaysActive && (org.membership_status === "active" || org.membership_status === "reactivated")) {
        patch.membership_status = "canceled";
      }

      if (Object.keys(patch).length > 0) {
        pullUpdates.push({ org, patch });
      }
    } else {
      const desiredTag = desiredTagForOrg(org);
      const wantsMemberTag = desiredTag === MEMBER_TAG_ID;
      const wantsPartnerTag = desiredTag === PARTNER_TAG_ID;

      if (wantsMemberTag === notionHasMemberTag && wantsPartnerTag === notionHasPartnerTag) {
        continue; // Notion already reflects Supabase's state
      }

      const nextRelationIds = relationIds.filter(
        (id) => normalizeId(id) !== normalizeId(MEMBER_TAG_ID) && normalizeId(id) !== normalizeId(PARTNER_TAG_ID)
      );
      if (desiredTag) nextRelationIds.push(desiredTag);

      pushUpdates.push({ org, page, nextRelationIds, wantsMemberTag, wantsPartnerTag });
    }

    await sleep(120); // stay well under Notion's ~3 req/s rate limit
  }

  // Notion pages tagged 25/26 with no matching Supabase notion_id — report
  // only, never insert.
  const taggedPages = await notionQueryTaggedOrgPages();
  const linkedNotionIds = new Set(orgs.map((o) => normalizeId(o.notion_id)));
  const unmatched = taggedPages
    .filter((page) => !linkedNotionIds.has(normalizeId(page.id)))
    .map((page) => getTitle(page.properties ?? {}, ORG_TITLE_PROPERTY_NAME) || page.id);

  console.log(`\nPull (Notion newer -> update Supabase): ${pullUpdates.length}`);
  for (const u of pullUpdates.slice(0, 20)) {
    console.log(`- ${u.org.name}: ${JSON.stringify(u.patch)}`);
  }

  console.log(`\nPush (Supabase authoritative -> update Notion tag): ${pushUpdates.length}`);
  for (const u of pushUpdates.slice(0, 20)) {
    console.log(`- ${u.org.name}: member=${u.wantsMemberTag} partner=${u.wantsPartnerTag}`);
  }

  if (unmatched.length > 0) {
    console.log(`\nNotion pages tagged 25/26 with no linked Supabase org (needs manual review, NOT auto-created): ${unmatched.length}`);
    for (const name of unmatched.slice(0, 30)) console.log(`- ${name}`);
  }

  if (errors.length > 0) {
    console.log(`\nErrors: ${errors.length}`);
    for (const e of errors) console.log(`- ${e}`);
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write changes.");
    return;
  }

  for (const { org, patch } of pullUpdates) {
    const { error } = await supabase
      .from("organizations")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", org.id);
    if (error) throw new Error(`Supabase update failed for ${org.name}: ${error.message}`);
  }

  for (const { org, nextRelationIds } of pushUpdates) {
    try {
      await notionUpdatePageTagRelation(org.notion_id, nextRelationIds);
    } catch (err) {
      errors.push(`${org.name}: Notion push failed: ${err.message}`);
    }
    await sleep(120);
  }

  console.log("\nApply complete.");
  console.log(`Supabase rows updated: ${pullUpdates.length}`);
  console.log(`Notion pages updated: ${pushUpdates.length - errors.length}`);
  if (errors.length > 0) {
    console.log(`Errors during apply: ${errors.length}`);
    for (const e of errors) console.log(`- ${e}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
