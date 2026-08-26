#!/usr/bin/env npx tsx
/** Dry look at what the kickoff guard would do today, and on other dates. */
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
process.env.ELECTIONS_SUPPRESS_EMAIL = "1";

const { ensureElectionKickoff } = await import("../lib/elections/cycle");

for (const today of [undefined, "2027-02-01"]) {
  const r = await ensureElectionKickoff(today ? { today } : {});
  console.log(`as of ${today ?? "today"}:`);
  console.log(`  cycle ....... ${r.cycleYear}`);
  console.log(`  needed ...... ${r.needed}`);
  console.log(`  created ..... ${r.created}`);
  console.log(`  raised at ... ${r.meetingDate ?? "—"}`);
  console.log(`  assigned .... ${r.assignedTo ?? "—"}`);
  console.log(`  note ........ ${r.note}\n`);
}
