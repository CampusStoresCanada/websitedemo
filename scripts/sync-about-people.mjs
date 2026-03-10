#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TARGETS = {
  staff: [
    "Carolyn Potter",
    "Greg McPherson",
    "Stephen Thomas",
  ],
  board_of_directors: [
    "Shannon Blackadder",
    "Jason Kack",
    "Sean Bell",
    "Imelda May",
    "Trish Linden-Teasdale",
    "Kevin Liu",
    "Sam Willis",
    "Shawn Davies",
    "Karin Stonehouse",
  ],
};

const DRY_RUN = process.argv.includes("--dry-run");

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] || "";
  const last = parts.slice(1).join(" ");
  return { first, last };
}

async function lookupContactByName(name) {
  const { data, error } = await db
    .from("contacts")
    .select("id,name,role_title,profile_picture_url,notes,updated_at")
    .ilike("name", name)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`contacts lookup failed for "${name}": ${error.message}`);
  }
  return data?.[0] ?? null;
}

async function lookupPersonByName(name) {
  const { first, last } = splitName(name);
  if (!first || !last) return null;

  const { data, error } = await db
    .from("people")
    .select("id,first_name,last_name,title,bio,avatar_url,updated_at")
    .ilike("first_name", first)
    .ilike("last_name", last)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`people lookup failed for "${name}": ${error.message}`);
  }
  return data?.[0] ?? null;
}

async function loadExistingRows() {
  const { data, error } = await db
    .from("site_content")
    .select("id,section,title,display_order,is_active")
    .in("section", Object.keys(TARGETS));

  if (error) {
    throw new Error(`site_content lookup failed: ${error.message}`);
  }

  const byKey = new Map();
  for (const row of data ?? []) {
    const key = `${row.section}::${String(row.title ?? "").trim().toLowerCase()}`;
    byKey.set(key, row);
  }
  return byKey;
}

function composePayload(name, section, displayOrder, contact, person) {
  const subtitle = contact?.role_title || person?.title || null;
  const body = person?.bio || contact?.notes || null;
  const imageUrl = contact?.profile_picture_url || person?.avatar_url || null;

  const source = {
    from_contact_id: contact?.id ?? null,
    from_person_id: person?.id ?? null,
    synced_at: new Date().toISOString(),
  };

  return {
    section,
    content_type: "person",
    title: name,
    subtitle,
    body,
    image_url: imageUrl,
    display_order: displayOrder,
    is_active: true,
    metadata: source,
  };
}

async function run() {
  const existingByKey = await loadExistingRows();
  const results = [];
  const missing = [];

  for (const [section, names] of Object.entries(TARGETS)) {
    for (const [index, name] of names.entries()) {
      const [contact, person] = await Promise.all([
        lookupContactByName(name),
        lookupPersonByName(name),
      ]);

      if (!contact && !person) {
        missing.push({ section, name });
        continue;
      }

      const payload = composePayload(name, section, index + 1, contact, person);
      const key = `${section}::${name.trim().toLowerCase()}`;
      const existing = existingByKey.get(key);

      if (existing) {
        if (!DRY_RUN) {
          const { error } = await db
            .from("site_content")
            .update(payload)
            .eq("id", existing.id);
          if (error) {
            throw new Error(`Failed updating ${section}/${name}: ${error.message}`);
          }
        }
        results.push({
          action: "updated",
          section,
          name,
          fromContact: Boolean(contact),
          fromPerson: Boolean(person),
          wasActive: existing.is_active,
        });
      } else {
        if (!DRY_RUN) {
          const { error } = await db.from("site_content").insert(payload);
          if (error) {
            throw new Error(`Failed inserting ${section}/${name}: ${error.message}`);
          }
        }
        results.push({
          action: "inserted",
          section,
          name,
          fromContact: Boolean(contact),
          fromPerson: Boolean(person),
        });
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: DRY_RUN,
        syncedCount: results.length,
        missingCount: missing.length,
        results,
        missing,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
