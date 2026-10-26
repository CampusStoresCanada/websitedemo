#!/usr/bin/env npx tsx
/**
 * Proof that an acclaimed slate can be closed, certified, and announced.
 *
 * SENDS NO EMAIL. ELECTIONS_SUPPRESS_EMAIL is set before any election module
 * is imported, because this exercises the real notify paths.
 *
 * SELF-CONTAINED AND SELF-CLEANING. Scratch election `scratch-acclaim-*`,
 * deleted at the end; every nomination and co-signature cascades with it. No
 * real record is written.
 *
 * It exists because the acclamation branch had never been run end to end:
 * closing with as many nominees as seats left the election on a status nothing
 * transitioned out of, so telling the candidates and announcing the result
 * were both permanently blocked.
 *
 *   npx tsx scripts/elections-acclamation-probe.mts
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

process.env.ELECTIONS_SUPPRESS_EMAIL = "1";

const { createAdminClient } = await import("../lib/supabase/admin");
const svc = await import("../lib/elections/service");
const { CSC_ELECTIONS_CONFIG } = await import("../lib/elections/config");

const db = createAdminClient();
const SLUG = "scratch-acclaim-probe";
const EMAILS = ["scratch-acclaim-1@example.invalid", "scratch-acclaim-2@example.invalid"];
const step = (n: string) => console.log(`\n── ${n}`);
let ok = 0;
let bad = 0;
const check = (label: string, pass: boolean, detail = "") => {
  console.log(`   ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  pass ? ok++ : bad++;
};

const MARKER = "scratch acclaim probe";

async function cleanup() {
  const { data } = await db.from("elections").select("id").eq("slug", SLUG).maybeSingle();
  if (data) await db.from("elections").delete().eq("id", data.id);
  // Keyed on a marker this script sets itself, never on a shared attribute.
  await db.from("governance_role_assignments").delete().eq("notes", MARKER);
  await db.from("contacts").delete().in("email", EMAILS);
}
await cleanup();

try {
  step("A scratch cycle with exactly as many seats as nominees");
  const body = (await db.from("governance_bodies").select("id").eq("key", "board_of_directors").single()).data!;
  const today = new Date();
  const iso = (d: number) => new Date(today.getTime() + d * 86_400_000).toISOString().slice(0, 10);

  const config = {
    ...CSC_ELECTIONS_CONFIG,
    eligibility: { ...CSC_ELECTIONS_CONFIG.eligibility, excludeTestOrganizations: false },
  };

  const election = (
    await db.from("elections").insert({
      slug: SLUG,
      body_id: body.id,
      cycle_year: 9998,
      agm_date: iso(-1),              // already happened, so announcing is reachable
      nominations_open_at: iso(-30),
      nominations_close_at: iso(2),   // OPEN while the nominations are created
      ballots_open_at: iso(-10),
      ballots_close_at: iso(-5),
      seats_available: 2,
      status: "nominating",
      config: JSON.parse(JSON.stringify(config)),
    }).select("id").single()
  ).data!;
  check("scratch election created", !!election.id);

  const testOrg = (
    await db.from("organizations").select("id, name").eq("name", "Test Org (Member)").single()
  ).data!;

  const contacts = [];
  for (const [i, email] of EMAILS.entries()) {
    const r = await db.from("contacts").insert({
      organization_id: testOrg.id,
      name: `Scratch Acclaim ${i + 1}`,
      first_name: "Scratch",
      last_name: `Acclaim ${i + 1}`,
      email,
    }).select("id").single();
    if (r.error) throw new Error(`contact insert failed: ${r.error.message}`);
    contacts.push(r.data);
  }
  check("two scratch nominees created", contacts.length === 2);

  // The term-limit check refuses to guess, so a nominee with NO recorded
  // history is unverifiable and never validates. This is the same zero-length,
  // non-counting marker the admin UI writes for somebody who has not served.
  for (const c of contacts) {
    await db.from("governance_role_assignments").insert({
      body_id: body.id,
      person_contact_id: c.id,
      role_key: "director",
      term_start: iso(0),
      term_end: iso(0),
      counts_toward_cap: false,
      notes: MARKER,
    });
  }
  const seeded = await svc.countConsecutiveTerms(body.id, null, contacts[0].id);
  check("no-service marker reads as 0, not null", seeded === 0, String(seeded));

  step("Two complete nominations for two seats");
  for (const c of contacts) {
    const created = await svc.createNomination({
      electionSlug: SLUG,
      nomineeContactId: c.id,
      nomineeOrganizationId: testOrg.id,
      source: "nominating_committee",   // committee slate: exempt from co-signatures
    });
    if (!created.ok) throw new Error(created.error);
    await db.from("nominations").update({
      candidate_accepted_at: new Date().toISOString(),
      store_permission_granted_at: new Date().toISOString(),
      bio: "Scratch biography.",
      platform: "Scratch candidate statement.",
      status: "accepted",
    }).eq("id", created.data.nominationId);
  }
  const before = await svc.listNominations(SLUG);
  check("both nominations complete", before.every((n) => n.completeness.complete),
    before.map((n) => n.completeness.missing.join("; ")).filter(Boolean).join(" | "));

  step("Closing acclaims rather than balloting");
  // Move the close into the past, the way the real calendar does. canCloseNominations
  // refuses an EARLY close, so the window has to have actually passed.
  await db.from("elections").update({ nominations_close_at: iso(-2) }).eq("id", election.id);
  const closed = await svc.closeNominations(SLUG);
  check("closed", closed.ok, closed.ok ? "" : closed.error);
  if (!closed.ok) throw new Error(closed.error);
  check("outcome is acclaimed", closed.data.outcome === "acclaimed", closed.data.reason);
  check("both validated", closed.data.validated === 2, `${closed.data.validated}`);

  const afterClose = (await db.from("elections").select("status, outcome").eq("id", election.id).single()).data!;
  check("status is nominations_closed", afterClose.status === "nominations_closed", String(afterClose.status));

  step("Sealing is refused — there is no ballot to seal");
  const seal = await svc.sealElection(SLUG, { confirmedNoFurtherVotes: true });
  check("seal refused", !seal.ok, seal.ok ? "SEALED AN ACCLAMATION" : seal.error);

  step("Certifying the acclamation");
  const admin = (await db.from("profiles").select("id").limit(1).single()).data!;
  const certified = await svc.certifyElection(SLUG, { certifiedByProfileId: admin.id });
  check("certified", certified.ok, certified.ok ? "" : certified.error);
  if (!certified.ok) throw new Error(certified.error);
  check("names both acclaimed directors", certified.data.elected.length === 2,
    certified.data.elected.map((e) => e.displayName).join(", "));

  const cert = (await db.from("election_certifications").select("ballots_returned, ballots_sealed, tie_at_cutoff, scrutineer_contact_id").eq("election_id", election.id).single()).data!;
  check("records no ballots, not a fake count",
    cert.ballots_returned === 0 && cert.ballots_sealed === 0 && cert.tie_at_cutoff === false && cert.scrutineer_contact_id === null);

  step("The two sends that were permanently blocked");
  const results = await svc.getResultsAnnouncement(SLUG);
  check("announcement is no longer blocked", !!results && results.canSend,
    results?.blockedReason ?? "no state");
  check("and it NAMES the acclaimed board",
    !!results && contacts.every((_, i) => results.html.includes(`Scratch Acclaim ${i + 1}`)),
    results ? results.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 180) : "");
  check("wording says acclamation, not ballot",
    !!results && /by acclamation/i.test(results.html) && !/result of the ballot/i.test(results.html));

  const told = await svc.notifyCandidates(SLUG, admin.id);
  check("candidates can be told", told.ok, told.ok ? "" : told.error);
  if (told.ok) {
    check("all elected, none not-elected", told.data.elected === 2 && told.data.notElected === 0,
      `${told.data.elected} elected / ${told.data.notElected} not`);
  }

  step("Certifying twice does not double-record");
  const again = await svc.certifyElection(SLUG, { certifiedByProfileId: admin.id });
  check("second certify refused", !again.ok, again.ok ? "RE-CERTIFIED" : again.error);
} finally {
  step("Cleanup");
  await cleanup();
  const left = (await db.from("elections").select("id").eq("slug", SLUG).maybeSingle()).data;
  check("scratch election removed", !left);
  const leftContacts = (await db.from("contacts").select("id").in("email", EMAILS)).data ?? [];
  check("scratch contacts removed", leftContacts.length === 0);
}

console.log(`\n${ok} passed, ${bad} failed\n`);
process.exit(bad === 0 ? 0 : 1);
