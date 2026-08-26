#!/usr/bin/env npx tsx
/**
 * Schedule the AGM for an election that was created before AGM scheduling
 * existed, then re-parent its action items so "announce the result" lands on the
 * AGM rather than on whatever meeting happened to precede it.
 *
 *   npx tsx scripts/elections-schedule-agm.mts board-2027
 */
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
process.env.ELECTIONS_SUPPRESS_EMAIL = "1";

const slug = process.argv[2] ?? "board-2027";
const { createAdminClient } = await import("../lib/supabase/admin");
const { getElection } = await import("../lib/elections/service");
const { ensureAgmMeetingAndEvent } = await import("../lib/elections/cycle");
const { mintElectionActionItems } = await import("../lib/elections/action-items");

const db = createAdminClient();
const election = await getElection(slug);
if (!election) throw new Error(`${slug} not found`);

const started = (election.config as unknown as { startedBy?: string }).startedBy;
const { data: anyAdmin } = await db
  .from("profiles").select("id").eq("global_role", "super_admin").limit(1);

const result = await ensureAgmMeetingAndEvent({
  agmDate: election.schedule.agmDate,
  cycleYear: election.cycleYear,
  createdByProfileId: started ?? (anyAdmin?.[0]?.id as string),
});
console.log(`AGM ${election.schedule.agmDate}`);
console.log(`  meeting ... ${result.meetingId ?? "—"}`);
console.log(`  event ..... ${result.eventId ?? "—"}`);
console.log(`  ${result.note}\n`);

// The announce item was parented to December because no January meeting existed.
const announceTitle = "Announce the result at the annual general meeting";
const { data: stale } = await db
  .from("board_action_items")
  .select("id, meeting_id, board_meetings(meeting_date)")
  .eq("title", announceTitle)
  .limit(1);

if (stale?.[0] && result.meetingId && stale[0].meeting_id !== result.meetingId) {
  const was = (stale[0].board_meetings as { meeting_date: string } | null)?.meeting_date;
  await db.from("board_action_items").update({ meeting_id: result.meetingId }).eq("id", stale[0].id);
  console.log(`Re-parented "${announceTitle}"`);
  console.log(`  ${was} → ${election.schedule.agmDate}`);
} else if (!stale?.[0]) {
  await mintElectionActionItems(election);
  console.log("Action items refreshed.");
} else {
  console.log("Announce item already on the AGM.");
}
