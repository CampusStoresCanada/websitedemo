#!/usr/bin/env node
/**
 * Does the /me agenda actually render a meeting?
 *
 * Nobody knows. `schedules` has 0 rows, so the meeting branch of
 * loadPersonAgenda has never executed against data, and agenda.test.ts covers
 * deriveAgenda only — 9 tests, zero mentions of meetings. Before any swap UI
 * goes on that surface, the surface has to be shown to work.
 *
 * So: one delegate, one exhibitor, one meeting between them. Scratch rows on
 * the three is_test orgs, never a real record, and --down removes every row
 * this created. It reuses the REAL registration entities, the REAL suites and
 * the REAL meeting slots, because a fixture that invents its own graph proves
 * nothing about the graph the product walks.
 *
 *   node scripts/agenda-meeting-fixture.mjs --up
 *   node scripts/agenda-meeting-fixture.mjs --status
 *   node scripts/agenda-meeting-fixture.mjs --down
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env may already be set */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// ── The world this fixture attaches to (all pre-existing, none of it written) ──
const CONFERENCE = "7e650b08-51d1-4573-a332-7d6b6fbc50bd"; // 2027 / edition 99
const POLICY_SET = "a0000000-0000-0000-0000-000000000001";
const ORG_MEMBER = "f7b3fee0-339f-404a-b77d-ec95f40e8f89"; // Test Org (Member)
const ORG_PARTNER = "1a5e240b-bf97-4534-93d5-b9b4cfe15bb3"; // Test Org (Partner)
const USER_MEMBER = "31cf8d02-1863-449a-b713-ba8c70161523"; // test.member@example.com
const USER_PARTNER = "367f6285-da3d-478e-a8aa-455530e14754"; // test.partner@example.com
const REG_DELEGATE = "a8fc5a0b-47a0-49df-aade-fd09ad5a034d"; // Full Conference Registration
const REG_EXHIBITOR = "b5e5e2a7-e2c2-4cbf-add6-117b7ea76bce"; // Exhibitor Staff Registration

/**
 * Every row this script writes carries this string somewhere findable, so
 * --down is an exact inverse rather than a guess at what looked like a fixture.
 */
const MARKER = "AGENDA-FIXTURE";

function die(step, error) {
  if (!error) return;
  console.error(`✗ ${step}: ${error.message ?? JSON.stringify(error)}`);
  process.exit(1);
}

async function pickSlot() {
  const { data, error } = await db
    .from("meeting_slots")
    .select("id, day_number, slot_number, start_time, end_time")
    .eq("conference_id", CONFERENCE)
    .order("day_number")
    .order("slot_number")
    .limit(1);
  die("pick meeting slot", error);
  if (!data?.length) die("pick meeting slot", { message: "no meeting_slots for this conference" });
  return data[0];
}

/** One side of the meeting: purchase → balance → person → named seat. */
async function buildSide({ label, orgId, userId, entityId, personKind, displayName }) {
  const purchaseId = randomUUID();
  die(
    `${label} purchase`,
    (
      await db.from("entity_purchases").insert({
        id: purchaseId,
        conference_id: CONFERENCE,
        offer_entity_id: entityId,
        quantity: 1,
        buyer: MARKER,
      })
    ).error
  );

  const balanceId = randomUUID();
  die(
    `${label} balance`,
    (
      await db.from("entity_balances").insert({
        id: balanceId,
        conference_id: CONFERENCE,
        purchase_id: purchaseId,
        entity_id: entityId,
        organization_id: orgId,
        quantity: 1,
      })
    ).error
  );

  const personId = randomUUID();
  die(
    `${label} person`,
    (
      await db.from("conference_people").insert({
        id: personId,
        conference_id: CONFERENCE,
        organization_id: orgId,
        user_id: userId,
        source_type: "manual",
        source_id: purchaseId,
        person_kind: personKind,
        display_name: displayName,
        admin_notes: MARKER,
      })
    ).error
  );

  const seatId = randomUUID();
  die(
    `${label} seat`,
    (
      await db.from("entity_balance_seats").insert({
        id: seatId,
        conference_id: CONFERENCE,
        organization_id: orgId,
        balance_id: balanceId,
        entity_id: entityId,
        seat_index: 1,
        holder_person_id: personId,
      })
    ).error
  );

  console.log(`  ${label}: person ${personId}  seat ${seatId}`);
  return { purchaseId, balanceId, personId, seatId };
}

async function up() {
  const existing = await db.from("entity_purchases").select("id").eq("buyer", MARKER);
  if (existing.data?.length) {
    console.error("✗ fixture already present — run --down first");
    process.exit(1);
  }

  console.log("Building fixture…");
  const slot = await pickSlot();
  console.log(`  slot: day ${slot.day_number} slot ${slot.slot_number} ${slot.start_time}-${slot.end_time}`);

  const delegate = await buildSide({
    label: "delegate",
    orgId: ORG_MEMBER,
    userId: USER_MEMBER,
    entityId: REG_DELEGATE,
    personKind: "delegate",
    displayName: "Fixture Delegate",
  });

  const exhibitor = await buildSide({
    label: "exhibitor",
    orgId: ORG_PARTNER,
    userId: USER_PARTNER,
    entityId: REG_EXHIBITOR,
    personKind: "exhibitor",
    displayName: "Fixture Exhibitor",
  });

  const runId = randomUUID();
  die(
    "scheduler run",
    (
      await db.from("scheduler_runs").insert({
        id: runId,
        conference_id: CONFERENCE,
        policy_set_id: POLICY_SET,
        run_seed: 1,
        run_mode: "draft",
        status: "completed",
        total_delegates: 1,
        total_exhibitors: 1,
        total_meetings_created: 1,
        completed_at: new Date().toISOString(),
        metadata: { fixture: MARKER },
      })
    ).error
  );

  const scheduleId = randomUUID();
  die(
    "schedule",
    (
      await db.from("schedules").insert({
        id: scheduleId,
        conference_id: CONFERENCE,
        scheduler_run_id: runId,
        meeting_slot_id: slot.id,
        exhibitor_seat_id: exhibitor.seatId,
        delegate_seat_ids: [delegate.seatId],
        status: "scheduled",
      })
    ).error
  );

  console.log(`  run ${runId}`);
  console.log(`  schedule ${scheduleId}`);
  console.log("\n✓ fixture up. Sign in as test.member@example.com and open /me");
}

async function status() {
  const { data: purchases } = await db.from("entity_purchases").select("id").eq("buyer", MARKER);
  const { data: people } = await db
    .from("conference_people")
    .select("id, display_name, user_id")
    .eq("admin_notes", MARKER);
  const { data: runs } = await db
    .from("scheduler_runs")
    .select("id")
    .contains("metadata", { fixture: MARKER });

  console.log(`purchases: ${purchases?.length ?? 0}`);
  console.log(`people:    ${people?.length ?? 0}`);
  console.log(`runs:      ${runs?.length ?? 0}`);

  for (const run of runs ?? []) {
    const { data: rows } = await db
      .from("schedules")
      .select("id, delegate_seat_ids, exhibitor_seat_id, meeting_slots(day_number, slot_number, start_time)")
      .eq("scheduler_run_id", run.id);
    for (const row of rows ?? []) {
      console.log(
        `  meeting ${row.id} → delegates ${JSON.stringify(row.delegate_seat_ids)} ` +
          `day ${row.meeting_slots?.day_number} slot ${row.meeting_slots?.slot_number}`
      );
    }
  }
}

async function down() {
  const { data: runs } = await db
    .from("scheduler_runs")
    .select("id")
    .contains("metadata", { fixture: MARKER });
  for (const run of runs ?? []) {
    await db.from("schedules").delete().eq("scheduler_run_id", run.id);
    await db.from("scheduler_runs").delete().eq("id", run.id);
  }

  const { data: people } = await db.from("conference_people").select("id").eq("admin_notes", MARKER);
  const personIds = (people ?? []).map((p) => p.id);
  if (personIds.length) await db.from("entity_balance_seats").delete().in("holder_person_id", personIds);

  const { data: purchases } = await db.from("entity_purchases").select("id").eq("buyer", MARKER);
  const purchaseIds = (purchases ?? []).map((p) => p.id);
  if (purchaseIds.length) await db.from("entity_balances").delete().in("purchase_id", purchaseIds);
  if (personIds.length) await db.from("conference_people").delete().in("id", personIds);
  if (purchaseIds.length) await db.from("entity_purchases").delete().in("id", purchaseIds);

  console.log(`✓ removed ${runs?.length ?? 0} run(s), ${personIds.length} person/seat, ${purchaseIds.length} purchase(s)`);
}

const mode = process.argv[2];
if (mode === "--up") await up();
else if (mode === "--down") await down();
else if (mode === "--status") await status();
else {
  console.error("usage: agenda-meeting-fixture.mjs --up | --status | --down");
  process.exit(1);
}
