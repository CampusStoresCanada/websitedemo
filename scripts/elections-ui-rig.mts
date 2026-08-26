#!/usr/bin/env npx tsx
/**
 * Stand up (and tear down) a one-institution scratch election so the admin
 * UI can be driven in a browser without addressing the membership.
 *
 * Why this exists: every automated test in this repo exercises the SERVICE
 * layer. On 2026-08-26 a full click-through found three defects living above
 * it — swallowed errors, dead buttons, a negative turnout count — while the
 * suite was green. The wiring between button and service has no other cover.
 *
 * The electorate is narrowed to Test Org alone by putting the AGM in 2030:
 * every real member's renewal lapses long before then, so they drop out on the
 * ordinary eligibility rule rather than by any special case. `seed` REFUSES if
 * that does not come out at exactly one institution, so a send can never reach
 * the membership by accident.
 *
 * ⚠️ Known limit: the AGM notice cannot be exercised on this rig. Its 21–35 day
 * window needs an AGM about a month out, and at that date every real member is
 * eligible again. Notice guards can be tested; the notice SEND cannot be,
 * without mailing everybody.
 *
 *   npx tsx scripts/elections-ui-rig.mts seed
 *   npx tsx scripts/elections-ui-rig.mts nominate 3
 *   npx tsx scripts/elections-ui-rig.mts phase closing|voting|counting
 *   npx tsx scripts/elections-ui-rig.mts teardown
 */
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
// Seeding must never mail. The BROWSER sends; this file only sets the stage.
process.env.ELECTIONS_SUPPRESS_EMAIL = "1";

const { createAdminClient } = await import("../lib/supabase/admin");
const { CSC_ELECTIONS_CONFIG } = await import("../lib/elections/config");
const db = createAdminClient();

export const TEST_ORG = "f7b3fee0-339f-404a-b77d-ec95f40e8f89";
const TEST_MEMBER = "31cf8d02-1863-449a-b713-ba8c70161523";
const SLUG = "scratch-ui-check";
const MARK = "scratch ui check";
const EMAIL_PREFIX = "scratch-ui-";
const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

/** Extra logins so a CONTESTED field has distinct people on it. */
const STANDINS = [
  { profile: TEST_MEMBER, first: "Nominee" },
  { profile: "677ce4be-3365-4ccd-81e1-80d4bc8cf118", first: "Second" },
  { profile: "367f6285-da3d-478e-a8aa-455530e14754", first: "Third" },
];

async function bodyId() {
  return (await db.from("governance_bodies").select("id").eq("key", "board_of_directors").single()).data!.id;
}

async function teardown() {
  const e = await db.from("elections").delete().eq("slug", SLUG).select("id");
  const g = await db.from("governance_role_assignments").delete().eq("notes", MARK).select("id");
  const c = await db.from("contacts").delete().like("email", `${EMAIL_PREFIX}%`).select("id");
  // ⚠️ Action items carry NO reference back to the election. They used to be
  // deduped — and cleaned — by title alone, and nine of the twelve titles had
  // no year in them ("Circulate ballots to the membership" is the same string
  // every cycle). That filter matched the REAL 2027 items and deleted nine of
  // them. Every title now carries {year}, so "2030" cannot appear on a genuine
  // record and this filter can only ever match rows this rig made.
  const t = await db.from("board_action_items").delete()
    .ilike("title", "%2030%").select("id");
  await db.from("organizations").update({ is_test: true }).eq("id", TEST_ORG);
  const org = (await db.from("organizations").select("is_test").eq("id", TEST_ORG).single()).data;
  console.log(`elections=${(e.data ?? []).length} terms=${(g.data ?? []).length} contacts=${(c.data ?? []).length} tasks=${(t.data ?? []).length} is_test=${org?.is_test}`);
}

async function seed() {
  await teardown();
  await db.from("organizations").update({ is_test: false }).eq("id", TEST_ORG);

  const bid = await bodyId();
  // Term history on record for each stand-in, so the 4-term cap is CHECKABLE.
  // With no rows the cap is unverifiable and the nominee is rightly held back.
  for (const s of STANDINS) {
    await db.from("governance_role_assignments").insert({
      body_id: bid, person_profile_id: s.profile, role_key: "director",
      term_start: "2015-01-01", term_end: "2017-01-01",
      counts_toward_cap: false, notes: MARK,
    });
  }

  // Test Org has an org_admin but NO contact row — the silent-zero shape, where
  // an institution is "notified" and receives nothing. Give it one.
  const admin = await db.from("contacts").insert({
    organization_id: TEST_ORG, name: "Scratch UI Admin",
    first_name: "Scratch", last_name: "Admin",
    email: `${EMAIL_PREFIX}admin@example.invalid`, profile_id: TEST_MEMBER,
  }).select("id").single();
  if (admin.error) throw new Error(admin.error.message);

  const election = await db.from("elections").insert({
    slug: SLUG, body_id: bid, cycle_year: 2030, agm_date: "2030-06-01",
    nominations_open_at: iso(-10), nominations_close_at: iso(5),
    ballots_open_at: iso(10), ballots_close_at: iso(40),
    seats_available: 2, status: "draft",
    config: JSON.parse(JSON.stringify(CSC_ELECTIONS_CONFIG)),
  }).select("id").single();
  if (election.error) throw new Error(election.error.message);

  const { evaluateElectionEligibility } = await import("../lib/elections/service");
  const { summary, verdicts } = await evaluateElectionEligibility(election.data.id);
  const ids = (verdicts as any[]).filter((v) => v.isEligible).map((v) => v.organizationId);
  if (ids.length !== 1 || ids[0] !== TEST_ORG) {
    await teardown();
    throw new Error(`REFUSING: electorate is ${ids.length}, not Test Org alone. Torn down; nothing can send.`);
  }
  console.log(`seeded. electorate ${summary.eligible} of ${summary.total} — Test Org alone. admin contact ${admin.data.id}`);
}

async function nominate(n: number) {
  const svc = await import("../lib/elections/service");
  for (const s of STANDINS.slice(0, n)) {
    const c = (await db.from("contacts").insert({
      organization_id: TEST_ORG, name: `Scratch UI ${s.first}`,
      first_name: "Scratch", last_name: s.first,
      email: `${EMAIL_PREFIX}${s.first.toLowerCase()}@example.invalid`,
    }).select("id").single()).data!;
    const created = await svc.createNomination({
      electionSlug: SLUG, nomineeContactId: c.id,
      nomineeOrganizationId: TEST_ORG, source: "nominating_committee",
    });
    if (!created.ok) throw new Error(created.error);
    await db.from("nominations").update({ store_permission_granted_at: new Date().toISOString() })
      .eq("id", created.data.nominationId);
    const acc = await svc.acceptNomination(created.data.acceptToken, s.profile, {
      bio: `${s.first} has run a campus store for a decade.`,
      platform: "Better data, shared procurement, plainer reporting.",
    });
    if (!acc.ok) throw new Error(`${s.first}: ${acc.error}`);
  }
  const r = (await svc.getCommitteeReview(SLUG))!;
  console.log(`nominations=${r.nominations.length} validated=${r.validated.length} — ${r.projected.outcome}`);
}

async function phase(name: string) {
  const map: Record<string, object> = {
    closing:  { nominations_close_at: iso(0), ballots_open_at: iso(0), ballots_close_at: iso(30) },
    voting:   { ballots_open_at: iso(0), ballots_close_at: iso(30) },
    counting: { ballots_close_at: iso(-1) },
  };
  if (!map[name]) throw new Error(`unknown phase ${name}`);
  await db.from("elections").update(map[name]).eq("slug", SLUG);
  const r = (await db.from("elections").select("status,nominations_close_at,ballots_open_at,ballots_close_at").eq("slug", SLUG).single()).data;
  console.log(JSON.stringify(r));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "seed") await seed();
else if (cmd === "nominate") await nominate(Number(arg ?? 3));
else if (cmd === "phase") await phase(arg);
else if (cmd === "teardown") await teardown();
else console.log("usage: seed | nominate <n> | phase closing|voting|counting | teardown");
