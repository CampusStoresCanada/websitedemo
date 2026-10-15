/**
 * Correct McGraw Hill's contact record.
 *
 *   npx tsx scripts/fix-mcgraw-hill-contacts.mts           # dry run
 *   npx tsx scripts/fix-mcgraw-hill-contacts.mts --apply   # writes
 *
 * Steve, 2026-10-06: "Andres is only vitalsource. McGraw is a different company
 * and we shouldn't be sending to Andres, we should be sending to the contact on
 * file." Then: "Fix the McGraw contact record."
 *
 * ⛔ ARCHIVES, never deletes. archivePersonContact sets archived_at so identity
 * lineage survives for future account linking. A hard delete would destroy the
 * only evidence of how this row came to exist.
 *
 * ⛔ Does NOT touch the user_organizations link. That row grants org_admin on
 * McGraw Hill and is an ACCESS decision, not a contact one. Surfaced to Steve.
 *
 * ⛔ Does NOT touch the VitalSource Andres row, and does not merge the two. A
 * matching name across two orgs says nothing about headcount; contacts are per
 * (person, org) deliberately.
 *
 * ⛔ Inserts directly rather than via addContact/ensureKnownPerson: that path
 * queues Circle provisioning, and pushing three new people into the community
 * is an outward-facing side effect nobody asked for.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { createAdminClient } = await import("../lib/supabase/admin");
const { archivePersonContact } = await import("../lib/identity/lifecycle");

const APPLY = process.argv.includes("--apply");
const WRONG_CONTACT_ID = "b66c64a5-7ec9-451a-a1d5-19e2bd88f63e"; // Andres @ McGraw Hill
const db = createAdminClient();

const { data: org, error: orgErr } = await db
  .from("organizations").select("id, name").eq("name", "McGraw Hill").maybeSingle();
if (orgErr) throw new Error(`org lookup: ${orgErr.message}`);
if (!org) throw new Error("McGraw Hill not found");

// From Steve's own invite list. Names as he supplied them.
const REAL = [
  { first_name: "Meghan",  last_name: "Clark",   email: "meghan.clark@mheducation.com" },
  { first_name: "Natasha", last_name: "Noble",   email: "natasha.noble@mheducation.com" },
  { first_name: "Patti",   last_name: "Rozakos", email: "patti.rozakos@mheducation.com" },
];

const { data: before, error: beforeErr } = await db
  .from("contacts").select("id, name, email, archived_at, profile_id")
  .eq("organization_id", org.id).order("name");
if (beforeErr) throw new Error(`contacts read: ${beforeErr.message}`);

console.log(`McGraw Hill (${org.id}) — ${before?.length ?? 0} contact rows today:`);
for (const c of before ?? []) {
  console.log(`  ${c.archived_at ? "[archived]" : "[active]  "} ${c.name} <${c.email}>${c.profile_id ? " (has login)" : ""}`);
}

const wrong = (before ?? []).find((c) => c.id === WRONG_CONTACT_ID);
if (!wrong) throw new Error(`contact ${WRONG_CONTACT_ID} is not on McGraw Hill — refusing to guess which row to archive`);

const existing = new Set((before ?? []).map((c) => (c.email ?? "").toLowerCase()));
const toAdd = REAL.filter((r) => !existing.has(r.email.toLowerCase()));

console.log(`\nwill archive : ${wrong.name} <${wrong.email}>`);
console.log(`will add     : ${toAdd.map((r) => `${r.first_name} ${r.last_name}`).join(", ") || "(none, all present)"}`);
console.log(`will NOT touch: the org_admin user_organizations link, the auth account, or the VitalSource row`);

if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); process.exit(0); }

if (toAdd.length) {
  const { error } = await db.from("contacts").insert(
    toAdd.map((r) => ({
      organization_id: org.id,
      first_name: r.first_name,
      last_name: r.last_name,
      name: `${r.first_name} ${r.last_name}`,
      email: r.email,
      // ⛔ Consent to be listed is PER PERSON. None of these three has agreed to
      // anything, so they start hidden and a human opts them in later.
      directory_visibility: "hidden",
      hidden: true,
      is_primary: false,
    }))
  );
  if (error) throw new Error(`insert failed: ${error.message}`);
  console.log(`inserted ${toAdd.length} contacts`);
}

const res = await archivePersonContact({ contactId: WRONG_CONTACT_ID });
if (!res.success) throw new Error(`archive failed: ${res.error}`);
console.log(`archived ${wrong.name}`);

const { data: after } = await db
  .from("contacts").select("name, email, archived_at")
  .eq("organization_id", org.id).is("archived_at", null).order("name");
console.log(`\nMcGraw Hill now has ${after?.length ?? 0} active contacts:`);
for (const c of after ?? []) console.log(`  ${c.name} <${c.email}>`);
