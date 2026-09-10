#!/usr/bin/env npx tsx
/**
 * Produce the "Full Member Directory CSV" outside the browser.
 *
 * Byte-for-byte the same output as exportFullMemberDirectoryCSV
 * (lib/actions/export-page.ts): same org filter (Member, active/reactivated,
 * not archived, not a test org), same contact filter (not archived, not
 * hidden), one row per PERSON, and an org with zero eligible contacts still
 * gets one row with blank contact fields.
 *
 * Exists so a partner's request can be answered by hand without asking them to
 * click through the toolkit. The gate the server action applies (caller must be
 * a Vendor Partner org_admin) is NOT reproduced here — running this script is
 * itself the authorisation, so only run it for someone who qualifies.
 *
 * Usage: npx tsx scripts/export-full-member-directory.mts [outfile]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

const OUT = process.argv[2] ?? `csc_members_full_${new Date().toISOString().slice(0, 10)}.csv`;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const { data: orgs, error: orgsError } = await db
  .from("organizations")
  .select("id, name, city, province, website")
  .eq("type", "Member")
  .in("membership_status", ["active", "reactivated"])
  .is("archived_at", null)
  .eq("is_test", false)
  .order("name");

if (orgsError) throw orgsError;
if (!orgs?.length) {
  console.error("No visible members found.");
  process.exit(1);
}

const { data: contacts, error: contactsError } = await db
  .from("contacts")
  .select("organization_id, name, role_title, work_email, email, work_phone_number, phone")
  .in("organization_id", orgs.map((o) => o.id))
  .is("archived_at", null)
  .not("hidden", "eq", true)
  .order("name");

if (contactsError) throw contactsError;

const byOrg = new Map<string, { name: string; roleTitle: string; email: string; phone: string }[]>();
for (const c of contacts ?? []) {
  if (!c.organization_id) continue;
  const list = byOrg.get(c.organization_id) ?? [];
  list.push({
    name: c.name ?? "",
    roleTitle: c.role_title ?? "",
    email: c.work_email || c.email || "",
    phone: c.work_phone_number || c.phone || "",
  });
  byOrg.set(c.organization_id, list);
}

const rows: string[][] = [
  ["Name", "City", "Province", "Website", "Contact Name", "Contact Title", "Contact Email", "Contact Phone"],
];
for (const o of orgs) {
  const base = [o.name ?? "", o.city ?? "", o.province ?? "", o.website ?? ""];
  const people = byOrg.get(o.id) ?? [];
  if (people.length === 0) {
    rows.push([...base, "", "", "", ""]);
    continue;
  }
  for (const p of people) rows.push([...base, p.name, p.roleTitle, p.email, p.phone]);
}

writeFileSync(OUT, rows.map((r) => r.map(csvEscape).join(",")).join("\n"), "utf8");
console.log(`${OUT}: ${rows.length - 1} rows across ${orgs.length} member orgs`);
