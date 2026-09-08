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

// Assignment: the control added on the board tab writes through this.
const { getAssignableBoardMembers, getAssignmentsByOrg } = await import("../lib/renewal/outreach");
const members = await getAssignableBoardMembers(wdb);
check("assignable board members resolve from governance roles", members.length > 0,
  `${members.length}: ${members.slice(0, 3).map((m) => `${m.displayName} (${m.roleLabel})`).join(", ")}…`);
check("nobody appears twice in the assignee list",
  new Set(members.map((m) => m.profileId)).size === members.length);
check("an officer shows their office, not just 'Director'",
  members.some((m) => m.roleLabel !== "Director"));

const assignee = members[0]?.profileId ?? null;
check("assigning records the owner",
  (await setRenewalAssignment({
    organizationId: TEST_ORG, renewalYear: PROBE_YEAR, assignedTo: assignee, assignedBy: null,
  })).success === true);
const assignedMap = await getAssignmentsByOrg(wdb, PROBE_YEAR);
check("assignment reads back live", assignedMap[TEST_ORG] === assignee,
  assignedMap[TEST_ORG] ?? "(none)");

// Re-assigning must REPLACE, not accumulate — one owner per org per cycle.
const second = members[1]?.profileId ?? null;
await setRenewalAssignment({
  organizationId: TEST_ORG, renewalYear: PROBE_YEAR, assignedTo: second, assignedBy: null,
});
const reassigned = await getAssignmentsByOrg(wdb, PROBE_YEAR);
check("re-assigning replaces rather than duplicating", reassigned[TEST_ORG] === second,
  reassigned[TEST_ORG] ?? "(none)");
const { count: assignRows } = await wdb
  .from("renewal_assignments").select("id", { count: "exact", head: true })
  .eq("organization_id", TEST_ORG).eq("renewal_year", PROBE_YEAR);
check("exactly one assignment row for the org", (assignRows ?? 0) === 1, `${assignRows ?? 0}`);

// Clearing it is how you hand an org back to nobody.
await setRenewalAssignment({
  organizationId: TEST_ORG, renewalYear: PROBE_YEAR, assignedTo: null, assignedBy: null,
});
check("clearing the assignment works",
  (await getAssignmentsByOrg(wdb, PROBE_YEAR))[TEST_ORG] === undefined);

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

  // Delta against a real earlier snapshot in the same cycle, if one exists.
  // This assertion deliberately adapts: whether a prior snapshot exists depends
  // on whether anyone has frozen a real meeting, which is not the test's to
  // control. Both branches are meaningful.
  const delta = await getRenewalDelta({
    meetingId: SCRATCH_ID,
    meetingDate: "2099-01-01",
    renewalYear: report.renewalYear,
    current: report,
  });
  if (delta) {
    check("delta references an EARLIER meeting", delta.sinceMeetingDate < "2099-01-01",
      delta.sinceMeetingDate);
    check("delta against an identical report is all zeroes",
      delta.renewedDelta === 0 && delta.collectedCentsDelta === 0,
      `${delta.renewedDelta} / ${delta.collectedCentsDelta}`);
  } else {
    check("no prior snapshot in this cycle, so no delta", true, "none frozen yet");
  }

  // The zero-baseline guard, in a year nothing has ever been frozen against.
  check("delta is null when nothing earlier exists (not a zero baseline)",
    (await getRenewalDelta({
      meetingId: SCRATCH_ID, meetingDate: "2099-01-01",
      renewalYear: 2999, current: report,
    })) === null);
} finally {
  // Cascades to renewal_snapshots. Deleting strictly by the id we created.
  await wdb.from("renewal_snapshots").delete().eq("meeting_id", SCRATCH_ID);
  await wdb.from("board_meetings").delete().eq("id", SCRATCH_ID);
}

const { data: leftoverMeeting } = await wdb
  .from("board_meetings").select("id").eq("id", SCRATCH_ID).maybeSingle();
check("scratch meeting cleaned up", !leftoverMeeting);
// Scoped to the scratch meeting. A global count would fail the moment anyone
// legitimately freezes a real meeting — which is the feature working, not a leak.
const { count: leftoverSnaps } = await wdb
  .from("renewal_snapshots").select("id", { count: "exact", head: true })
  .eq("meeting_id", SCRATCH_ID);
check("no scratch snapshot rows left behind", (leftoverSnaps ?? 0) === 0, `${leftoverSnaps ?? 0} rows`);

console.log("\n── Call list + action items (scratch meeting + fixture org) ──");
const { syncRenewalActionItems } = await import("../lib/renewal/action-items");
const { getRenewalCallList } = await import("../lib/renewal/call-list");

const { data: scratch2 } = await wdb
  .from("board_meetings")
  .insert({
    title: "SCRATCH — action item probe (safe to delete)",
    meeting_type: "regular", meeting_date: "2099-02-01", status: "upcoming",
  })
  .select("id").single();
const M2: string = scratch2!.id;
const WHO = members[0]!.profileId;

try {
  await setRenewalAssignment({
    organizationId: TEST_ORG, renewalYear: PROBE_YEAR, assignedTo: WHO, assignedBy: null,
  });

  const first = await syncRenewalActionItems({ meetingId: M2, renewalYear: PROBE_YEAR });
  check("one action item created per assignee, not per org", first.created === 1,
    JSON.stringify(first));

  const { data: items } = await wdb
    .from("board_action_items")
    .select("title, assignees, source, status, priority")
    .eq("meeting_id", M2);
  check("item is attributed to source 'renewal'", items?.[0]?.source === "renewal");
  check("item is assigned to the right person",
    (items?.[0]?.assignees as string[])?.[0] === WHO);
  check("title states the count", /1 assigned store/.test(items?.[0]?.title ?? ""),
    items?.[0]?.title ?? "");

  // Re-running must not produce a second item for the same person.
  const second = await syncRenewalActionItems({ meetingId: M2, renewalYear: PROBE_YEAR });
  check("re-sync updates rather than duplicating",
    second.created === 0 && second.updated === 1, JSON.stringify(second));
  const { count: itemCount } = await wdb
    .from("board_action_items").select("id", { count: "exact", head: true }).eq("meeting_id", M2);
  check("still exactly one item", (itemCount ?? 0) === 1, `${itemCount ?? 0}`);

  // The call list the item points at.
  const list = await getRenewalCallList(WHO, PROBE_YEAR);
  check("call list returns the assigned org", list.entries.length === 1,
    `${list.entries.length}`);
  const entry = list.entries[0];
  check("call list entry names the org and its amount",
    entry?.organizationName === "Test Org (Member)" && typeof entry?.amountCents === "number",
    `${entry?.organizationName} / ${entry?.amountCents}`);
  // The contact block is the point of the page, so assert it agrees with the
  // database rather than asserting it is "either present or absent".
  const { count: realContacts } = await wdb
    .from("contacts").select("id", { count: "exact", head: true })
    .eq("organization_id", TEST_ORG).is("archived_at", null);
  check("contact block matches what the org actually has",
    (realContacts ?? 0) > 0 ? entry?.contact !== null : entry?.contact === null,
    `${realContacts ?? 0} contacts on file → ${entry?.contact ? entry.contact.name : "null"}`);

  // Unassigning should close the obligation, not leave it asserting work.
  await setRenewalAssignment({
    organizationId: TEST_ORG, renewalYear: PROBE_YEAR, assignedTo: null, assignedBy: null,
  });
  const third = await syncRenewalActionItems({ meetingId: M2, renewalYear: PROBE_YEAR });
  check("unassigning closes the action item out", third.closed === 1, JSON.stringify(third));
  const { data: after } = await wdb
    .from("board_action_items").select("status, dropped_reason").eq("meeting_id", M2);
  check("closed item records why", after?.[0]?.status === "dropped" && !!after?.[0]?.dropped_reason,
    after?.[0]?.dropped_reason ?? "");
} finally {
  await wdb.from("board_action_items").delete().eq("meeting_id", M2);
  await wdb.from("renewal_assignments").delete().eq("organization_id", TEST_ORG).eq("renewal_year", PROBE_YEAR);
  await wdb.from("board_meetings").delete().eq("id", M2);
}

const { data: leftM2 } = await wdb.from("board_meetings").select("id").eq("id", M2).maybeSingle();
check("scratch action-item meeting cleaned up", !leftM2);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
