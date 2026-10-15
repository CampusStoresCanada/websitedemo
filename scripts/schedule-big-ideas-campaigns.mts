/**
 * Schedule every Big Ideas Day campaign for Friday 2026-10-09, 9:00 a.m. MDT.
 *
 *   npx tsx scripts/schedule-big-ideas-campaigns.mts           # dry run
 *   npx tsx scripts/schedule-big-ideas-campaigns.mts --apply   # schedules
 *
 * ⛔ 9:00 MDT is deliberate, not arbitrary. Conference in a Box fires at 6:15
 * the same morning and four orgs are in both sets (Ambassador, Bookware,
 * PrismRBS, VitalSource). Nearly three hours apart means two emails, not a
 * batch landing in the same minute.
 *
 * ⛔ MDT is UTC-6 on this date. DST does not end until 2026-11-01, so 9:00
 * local is 15:00Z. Getting this wrong by an hour is silent.
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const { createAdminClient } = await import("../lib/supabase/admin");
const { scheduleCampaign } = await import("../lib/comms/send");

const APPLY = process.argv.includes("--apply");
const WHEN = new Date("2026-10-09T15:00:00.000Z");
const db = createAdminClient();

const { data: init, error: initErr } = await db
  .from("comms_campaigns").select("id, name").eq("name", "Big Ideas Day — 2027");
if (initErr) throw new Error(`initiative: ${initErr.message}`);
if (!init?.length) throw new Error("no Big Ideas Day — 2027 initiative");
if (init.length > 1) throw new Error(`${init.length} initiatives share that name — refusing to guess`);

const { data: campaigns, error } = await db
  .from("message_campaigns")
  .select("id, name, status, scheduled_at, audience_definition")
  .eq("campaign_id", init[0].id)
  .order("name");
if (error) throw new Error(`campaigns: ${error.message}`);

console.log(`${WHEN.toISOString()}  =  Fri 9 Oct 2026, 9:00 a.m. MDT\n`);
let total = 0;
for (const c of campaigns ?? []) {
  const n = (c.audience_definition as { filters?: { recipients?: unknown[] } })?.filters?.recipients?.length ?? 0;
  total += n;
  console.log(`  ${String(n).padStart(3)}  ${c.status.padEnd(9)} ${c.name}`);
}
console.log(`  ${String(total).padStart(3)}  TOTAL across ${campaigns?.length ?? 0} campaigns`);

if (!APPLY) { console.log("\nDRY RUN — nothing scheduled. Re-run with --apply."); process.exit(0); }

for (const c of campaigns ?? []) {
  const res = await scheduleCampaign(c.id, WHEN);
  if (!res.success) throw new Error(`${c.name}: ${res.error}`);
  console.log(`scheduled  ${c.name}`);
}

const { data: after } = await db
  .from("message_campaigns").select("name, status, scheduled_at")
  .eq("campaign_id", init[0].id).order("name");
console.log();
for (const c of after ?? []) console.log(`  ${c.status.padEnd(9)} ${c.scheduled_at}  ${c.name}`);
