#!/usr/bin/env npx tsx
/**
 * Give the Board of Directors their conference seats.
 *
 * ⚠️ THIS IS ONE STEP OF A PIPELINE THAT DOES NOT EXIST YET. When an election
 * resolves, a board member should receive their whole entitlement set — admin
 * role, conference seat, portfolio access, Circle moderator, and so on. Only
 * the conference seat is built. Keep this callable and idempotent so the
 * pipeline can invoke it rather than reimplementing it.
 *
 * WHO GETS A SEAT — the rule, in the user's words:
 *   "Everyone from the year prior works on the conference and is invited to
 *    attend on CSC's dime because they put in the work. The new board members
 *    are invited to the conference (and the board meeting on the weekend prior)
 *    on CSC's dime."
 *
 * So it is NOT "the board on the day of the conference". It is the UNION of
 * outgoing, continuing and incoming: anyone whose board term overlaps the year
 * leading up to the conference. An outgoing director whose term ended a month
 * before still ran the year that produced this conference, and still attends.
 *
 * ⛔ CSC staff are excluded even when they hold a board role. The Executive
 * Director sits on the board but works the conference, so he keeps his Staff
 * Registration — staff wins. Without this, Greg McPherson would hold two
 * registration types and preflight would (correctly) block the print run.
 *
 * Idempotent: re-running seats only people who do not already have a seat on
 * this type. Dry-run by default; pass --apply to commit.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const APPLY = process.argv.includes("--apply");
const conferenceId = process.argv.find((a) => /^[0-9a-f-]{36}$/.test(a));
if (!conferenceId) throw new Error("usage: seat-board-for-conference.mts <conferenceId> [--apply]");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BOARD_TYPE_NAME = "Board Registration";

const { data: conf, error: confErr } = await db
  .from("conference_instances")
  .select("id, name, start_date, end_date")
  .eq("id", conferenceId)
  .single();
if (confErr || !conf) throw new Error(confErr?.message ?? "conference not found");
console.log(`${conf.name} (${conf.start_date} → ${conf.end_date}) — ${APPLY ? "APPLYING" : "dry run"}\n`);

// ── The catalogue type. Same access as Full Conference INCLUDING the meeting
//    blocks — the board takes meetings, which is what separates it from Staff
//    Registration. Comp'd, not for sale.
const { data: types, error: typeErr } = await db
  .from("conference_entities")
  .select("id, name")
  .eq("conference_id", conferenceId)
  .eq("kind", "registration");
if (typeErr) throw new Error(typeErr.message);
const boardType = types?.find((t) => t.name === BOARD_TYPE_NAME);
const fullConf = types?.find((t) => t.name === "Full Conference Registration");
if (!boardType) {
  console.log(`❌ "${BOARD_TYPE_NAME}" does not exist in this conference's catalogue.`);
  console.log(`   Create it (copying ${fullConf ? `"${fullConf.name}"` : "Full Conference Registration"} refs, meeting blocks INCLUDED) before seating.`);
  process.exit(1);
}

// ── Who. Term overlaps the year leading up to the conference.
const windowStart = new Date(conf.start_date);
windowStart.setFullYear(windowStart.getFullYear() - 1);
const { data: assignments, error: gErr } = await db
  .from("governance_role_assignments")
  .select("person_contact_id, organization_id, role_key, term_start, term_end, governance_bodies!inner(name)")
  .eq("governance_bodies.name", "Board of Directors")
  .lte("term_start", conf.end_date);
if (gErr) throw new Error(gErr.message);

const inWindow = (assignments ?? []).filter(
  (a) => !a.term_end || new Date(a.term_end) >= windowStart
);
const contactIds = [...new Set(inWindow.map((a) => a.person_contact_id).filter(Boolean))];

const { data: contacts, error: cErr } = await db
  .from("contacts")
  .select("id, first_name, last_name, work_email, role_title, organization_id, profile_id")
  .in("id", contactIds);
if (cErr) throw new Error(cErr.message);

const { data: orgs, error: oErr } = await db
  .from("organizations")
  .select("id, name, type")
  .in("id", [...new Set((contacts ?? []).map((c) => c.organization_id).filter(Boolean))]);
if (oErr) throw new Error(oErr.message);
const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));

const { data: existingPeople } = await db
  .from("conference_people")
  .select("id, contact_id")
  .eq("conference_id", conferenceId);
const personByContact = new Map((existingPeople ?? []).map((p) => [p.contact_id, p.id]));

const { data: heldSeats } = await db
  .from("entity_balance_seats")
  .select("holder_person_id")
  .eq("conference_id", conferenceId)
  .eq("entity_id", boardType.id);
const alreadySeated = new Set((heldSeats ?? []).map((s) => s.holder_person_id));

let toSeat = 0;
let skipped = 0;
for (const c of contacts ?? []) {
  const org = c.organization_id ? orgById.get(c.organization_id) : null;
  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  // Staff wins — see the header. The ED works the conference.
  if (org?.type === "Staff") {
    console.log(`⏭  ${name} — CSC staff, keeps Staff Registration`);
    skipped += 1;
    continue;
  }
  const existingPersonId = personByContact.get(c.id);
  if (existingPersonId && alreadySeated.has(existingPersonId)) {
    console.log(`✓  ${name} — already seated`);
    continue;
  }
  console.log(`+  ${name} (${org?.name ?? "no org"})`);
  toSeat += 1;
}

console.log(
  `\n${toSeat} to seat, ${skipped} skipped as staff.${APPLY ? "" : " Re-run with --apply to commit."}`
);
if (!APPLY) process.exit(0);

// ── Seat them. entity_balances.purchase_id is NOT NULL, so a zero-price
//    purchase is what makes a comp'd seat expressible at all — same chain
//    Staff Registration uses.
const CSC_BOARD_BUYER = "Campus Stores Canada (board comp)";

let { data: purchase } = await db
  .from("entity_purchases")
  .select("id")
  .eq("conference_id", conferenceId)
  .eq("offer_entity_id", boardType.id)
  .maybeSingle();
if (!purchase) {
  const ins = await db
    .from("entity_purchases")
    .insert({
      conference_id: conferenceId,
      offer_entity_id: boardType.id,
      quantity: toSeat,
      buyer: CSC_BOARD_BUYER,
      price_cents: 0,
      buyer_tier: "board",
    })
    .select("id")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  purchase = ins.data;
}

let seated = 0;
for (const c of contacts ?? []) {
  const org = c.organization_id ? orgById.get(c.organization_id) : null;
  if (org?.type === "Staff") continue;
  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();

  let personId = personByContact.get(c.id);
  if (personId && alreadySeated.has(personId)) continue;

  if (!personId) {
    const ins = await db
      .from("conference_people")
      .insert({
        conference_id: conferenceId,
        organization_id: c.organization_id,
        user_id: c.profile_id,
        canonical_person_id: c.id,
        contact_id: c.id,
        source_type: "manual",
        source_id: crypto.randomUUID(),
        person_kind: "delegate",
        display_name: name,
        contact_email: c.work_email,
        role_title: c.role_title,
        assignment_status: "assigned",
        assigned_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (ins.error) {
      console.log(`   ${name}: ${ins.error.message}`);
      continue;
    }
    personId = ins.data.id;
  }

  // A board member's seat belongs to THEIR org — a director from Lakeland is
  // seated against Lakeland, not against CSC. The comp is who paid, not who
  // the person belongs to.
  let { data: balance } = await db
    .from("entity_balances")
    .select("id")
    .eq("conference_id", conferenceId)
    .eq("entity_id", boardType.id)
    .eq("organization_id", c.organization_id)
    .maybeSingle();
  if (!balance) {
    const ins = await db
      .from("entity_balances")
      .insert({
        conference_id: conferenceId,
        purchase_id: purchase!.id,
        entity_id: boardType.id,
        quantity: 1,
        organization_id: c.organization_id,
      })
      .select("id")
      .single();
    if (ins.error) {
      console.log(`   ${name}: ${ins.error.message}`);
      continue;
    }
    balance = ins.data;
  }

  const seat = await db.from("entity_balance_seats").insert({
    conference_id: conferenceId,
    organization_id: c.organization_id,
    balance_id: balance!.id,
    entity_id: boardType.id,
    seat_index: 1,
    holder_person_id: personId,
  });
  if (seat.error) {
    console.log(`   ${name}: ${seat.error.message}`);
    continue;
  }
  seated += 1;
  console.log(`✅ ${name}`);
}

console.log(`\n${seated} board members seated.`);
