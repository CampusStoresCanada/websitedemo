#!/usr/bin/env npx tsx
/**
 * Create the board action items for an election, assigned to whoever holds each
 * office. Pass --dry to see the plan without writing.
 *
 *   npx tsx scripts/elections-mint-tasks.mts board-2027 --dry
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
const dryRun = process.argv.includes("--dry");

const { getElection } = await import("../lib/elections/service");
const { mintElectionActionItems } = await import("../lib/elections/action-items");

const election = await getElection(slug);
if (!election) throw new Error(`${slug} not found`);

console.log(`${dryRun ? "DRY RUN — " : ""}action items for ${slug} (AGM ${election.schedule.agmDate})\n`);
const results = await mintElectionActionItems(election, { dryRun });

for (const r of results) {
  const owner = r.assignedTo ? `${r.assignedTo.name} (${r.assignedTo.role})` : "UNASSIGNED";
  console.log(`  due ${r.dueDate}  ·  raised at ${r.meetingDate ?? "NO MEETING BEFORE THIS DATE"}`);
  console.log(`    ${r.title}`);
  console.log(`    → ${owner}${r.created ? "  [created]" : dryRun ? "" : "  [already present]"}`);
  if (r.unassignedReason) console.log(`    ! ${r.unassignedReason}`);
  console.log();
}
const noMeeting = results.filter((r) => !r.meetingDate);
if (noMeeting.length) console.log(`⚠ ${noMeeting.length} item(s) have no board meeting before their due date.`);
