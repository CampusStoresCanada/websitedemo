#!/usr/bin/env npx tsx
/**
 * Live proof of the board renewal report against the real DB. READ ONLY —
 * writes nothing, touches no membership, invoice, or contact record.
 *
 *   npx tsx scripts/board-renewal-report-live-check.mts
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env may already be set */
}

const { getBoardRenewalReport, resolveBoardRenewalWindow } = await import(
  "../lib/renewal/board-report"
);
const { getRenewalProgressData } = await import("../lib/renewal/renewal-progress");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else    { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
const money = (c: number) => `$${(c / 100).toLocaleString("en-CA")}`;

console.log("\n── Window resolution (keyed on MEETING date, not today) ──");
const windowCases: [string, boolean][] = [
  ["2026-08-27", true],   // today's meeting
  ["2026-09-24", true],
  ["2026-10-29", true],   // first meeting after the Oct 1 grace cliff
  ["2026-11-26", true],
  ["2026-12-17", false],  // out — three months past cycle start
  ["2027-01-21", false],  // AGM
  ["2026-07-30", false],  // before the window opens
];
for (const [date, expected] of windowCases) {
  const w = await resolveBoardRenewalWindow(date);
  check(
    `${date} ${expected ? "in" : "out of"} window`,
    (w !== null) === expected,
    w ? `renewalYear ${w.renewalYear}` : "null"
  );
}

const aug = await resolveBoardRenewalWindow("2026-08-27");
const nov = await resolveBoardRenewalWindow("2026-11-26");
check(
  "Aug and Nov meetings resolve to the SAME renewal year",
  aug?.renewalYear === nov?.renewalYear,
  `${aug?.renewalYear} vs ${nov?.renewalYear}`
);

console.log("\n── Report for the 2026-08-27 meeting ──");
const report = await getBoardRenewalReport("2026-08-27");
if (!report) {
  console.log("  ✗ report was null for an in-window meeting");
  process.exit(1);
}

for (const [key, t] of Object.entries(report.types)) {
  console.log(
    `  ${key.padEnd(15)} ${t.renewedCount}/${t.populationCount} renewed · ` +
    `collected ${money(t.collectedCents)} · outstanding ${money(t.outstandingCents)} ` +
    `(${t.outstanding.length} orgs)`
  );
  check(
    `${key}: outstanding list length matches population − renewed`,
    t.outstanding.length === t.populationCount - t.renewedCount
  );
  check(
    `${key}: collected + outstanding = total expected`,
    t.collectedCents + t.outstandingCents === t.totalExpectedCents,
    `${money(t.collectedCents)} + ${money(t.outstandingCents)} = ${money(t.totalExpectedCents)}`
  );
  check(`${key}: outstanding list is alphabetical`,
    t.outstanding.every((o, i, a) => i === 0 || a[i - 1].name.localeCompare(o.name) <= 0));
  check(`${key}: no org appears twice`,
    new Set(t.outstanding.map((o) => o.organizationId)).size === t.outstanding.length);
}

console.log(`  TOTAL           ${report.totals.renewedCount}/${report.totals.populationCount} renewed · ` +
  `collected ${money(report.totals.collectedCents)} · outstanding ${money(report.totals.outstandingCents)}`);

console.log("\n── Agreement with the /admin widget (must never diverge) ──");
const widget = await getRenewalProgressData();
if (!widget) {
  console.log("  ⚠ widget returned null (outside the operational season) — skipping comparison");
} else {
  for (const key of Object.keys(report.types) as (keyof typeof report.types)[]) {
    const b = report.types[key];
    const w = widget.types[key];
    check(`${key}: population matches widget`, b.populationCount === w.populationCount,
      `${b.populationCount} vs ${w.populationCount}`);
    check(`${key}: renewed matches widget`, b.renewedCount === w.renewedCount,
      `${b.renewedCount} vs ${w.renewedCount}`);
    // Both surfaces price through getExpectedAmountsByOrg, so these must agree
    // exactly. A divergence means one of them stopped using the shared helper.
    check(`${key}: collected matches widget`, b.collectedCents === w.collectedCents,
      `${money(b.collectedCents)} vs ${money(w.collectedCents)}`);
    check(`${key}: total expected matches widget`, b.totalExpectedCents === w.totalExpectedCents,
      `${money(b.totalExpectedCents)} vs ${money(w.totalExpectedCents)}`);
  }
}

console.log("\n── Outreach write path (Test Org fixture only, self-cleaning) ──");
// NEVER against a real member: a probe that writes to a live org is how real
// records get damaged. This uses the is_test fixture and deletes what it wrote.
const TEST_ORG = "f7b3fee0-339f-404a-b77d-ec95f40e8f89"; // Test Org (Member)
const { logRenewalContact, setRenewalAssignment, getOutreachByOrg } = await import(
  "../lib/renewal/outreach"
);
const { createAdminClient } = await import("../lib/supabase/admin");
const wdb = createAdminClient();
const PROBE_YEAR = 2999; // far outside any real cycle, so it can never pollute a report

const logged = await logRenewalContact({
  organizationId: TEST_ORG,
  renewalYear: PROBE_YEAR,
  contactedBy: null,
  channel: "call",
  outcome: "undecided",
  note: "live-check probe",
});
check("logRenewalContact reports success", logged.success === true,
  logged.success ? logged.id : (logged as { error: string }).error);

const assigned = await setRenewalAssignment({
  organizationId: TEST_ORG, renewalYear: PROBE_YEAR, assignedTo: null, assignedBy: null,
});
check("setRenewalAssignment reports success", assigned.success === true);

// The point of this section: a grant without a policy returns zero rows with a
// null error, so "success" proves nothing. Read it back.
const readBack = await getOutreachByOrg(wdb, [TEST_ORG], PROBE_YEAR);
const row = readBack.get(TEST_ORG);
check("the logged contact actually persisted", row?.contactCount === 1,
  `contactCount=${row?.contactCount ?? 0}`);
check("the note round-tripped", row?.lastContact?.note === "live-check probe",
  row?.lastContact?.note ?? "(nothing)");
check("channel and outcome round-tripped",
  row?.lastContact?.channel === "call" && row?.lastContact?.outcome === "undecided");

const badChannel = await logRenewalContact({
  organizationId: TEST_ORG, renewalYear: PROBE_YEAR, contactedBy: null,
  channel: "carrier-pigeon" as never, outcome: "undecided", note: null,
});
check("an unknown channel is rejected", badChannel.success === false);

// Clean up — leave the database exactly as found.
await wdb.from("renewal_contact_log").delete().eq("organization_id", TEST_ORG).eq("renewal_year", PROBE_YEAR);
await wdb.from("renewal_assignments").delete().eq("organization_id", TEST_ORG).eq("renewal_year", PROBE_YEAR);
const afterClean = await getOutreachByOrg(wdb, [TEST_ORG], PROBE_YEAR);
check("probe rows cleaned up", !afterClean.has(TEST_ORG));

console.log("\n── Snapshot freezing (scratch meeting, self-cleaning) ──");
// Creates its OWN board_meetings row and deletes it by id at the end. Never
// touches a real meeting — board minutes have been destroyed by a test probe
// in this project before.
const { getRenewalSnapshot, saveRenewalSnapshot, approveRenewalSnapshot, getRenewalDelta } =
  await import("../lib/renewal/snapshot");

const { data: scratch, error: scratchErr } = await wdb
  .from("board_meetings")
  .insert({
    title: "SCRATCH — live-check snapshot probe (safe to delete)",
    meeting_type: "regular",
    // Far future: board_meetings has a UNIQUE constraint on meeting_date, so a
    // scratch row cannot share a date with a real meeting.
    meeting_date: "2099-01-01",
    status: "upcoming",
  })
  .select("id")
  .single();

if (scratchErr || !scratch) {
  console.log(`  ✗ could not create scratch meeting — ${scratchErr?.message}`);
  process.exit(1);
}
const SCRATCH_ID: string = scratch.id;

try {
  check("no snapshot before freezing", (await getRenewalSnapshot(SCRATCH_ID)) === null);

  const frozen = await saveRenewalSnapshot({
    meetingId: SCRATCH_ID, report, pulledBy: null,
  });
  check("saveRenewalSnapshot reports success", frozen.success === true);

  const readBack = await getRenewalSnapshot(SCRATCH_ID);
  check("snapshot persisted", readBack !== null);
  check("frozen totals match what was passed in",
    readBack?.report.totals.renewedCount === report.totals.renewedCount &&
    readBack?.report.totals.collectedCents === report.totals.collectedCents,
    `${readBack?.report.totals.renewedCount}/${readBack?.report.totals.collectedCents}`);
  check("named outstanding list survives the round trip",
    (readBack?.report.types["Vendor Partner"].outstanding.length ?? 0) ===
      report.types["Vendor Partner"].outstanding.length);
  check("not approved yet", readBack?.approvedAt === null);

  // Re-pull before approval is allowed and replaces the draft.
  check("re-pull before approval is allowed",
    (await saveRenewalSnapshot({ meetingId: SCRATCH_ID, report, pulledBy: null })).success === true);

  const approved = await approveRenewalSnapshot({ meetingId: SCRATCH_ID, approvedBy: null });
  check("approve succeeds", approved.success === true);
  check("approval is recorded", (await getRenewalSnapshot(SCRATCH_ID))?.approvedAt !== null);

  // The point of the table: an approved figure cannot be silently replaced.
  const afterApproval = await saveRenewalSnapshot({
    meetingId: SCRATCH_ID, report, pulledBy: null,
  });
  check("re-pull AFTER approval is refused", afterApproval.success === false,
    afterApproval.success ? "it was allowed" : afterApproval.error);

  check("double approve is refused",
    (await approveRenewalSnapshot({ meetingId: SCRATCH_ID, approvedBy: null })).success === false);

  // Delta needs a PRIOR meeting's snapshot; this scratch meeting is the only
  // one in the year, so there is nothing earlier to compare against.
  const delta = await getRenewalDelta({
    meetingId: SCRATCH_ID,
    meetingDate: "2099-01-01",
    renewalYear: report.renewalYear,
    current: report,
  });
  check("delta is null with no earlier snapshot (not a zero baseline)", delta === null,
    delta ? JSON.stringify(delta) : "null");
} finally {
  // Cascades to renewal_snapshots. Deleting strictly by the id we created.
  await wdb.from("renewal_snapshots").delete().eq("meeting_id", SCRATCH_ID);
  await wdb.from("board_meetings").delete().eq("id", SCRATCH_ID);
}

const { data: leftoverMeeting } = await wdb
  .from("board_meetings").select("id").eq("id", SCRATCH_ID).maybeSingle();
check("scratch meeting cleaned up", !leftoverMeeting);
const { count: leftoverSnaps } = await wdb
  .from("renewal_snapshots").select("id", { count: "exact", head: true });
check("no snapshot rows left behind", (leftoverSnaps ?? 0) === 0, `${leftoverSnaps ?? 0} rows`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
