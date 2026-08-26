#!/usr/bin/env npx tsx
/**
 * Live proof of the elections eligibility runner against the real DB.
 *
 * Read-mostly: the only write is upserting verdicts into `election_eligibility`,
 * which is what the runner is for. Touches no membership, contact, or ballot
 * record. Safe to re-run — it is re-runnable by design, because a store with an
 * outstanding renewal becomes eligible the day it pays.
 *
 *   npx tsx scripts/elections-live-check.mts
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

const { getElection, evaluateElectionEligibility, countConsecutiveTerms } = await import(
  "../lib/elections/service"
);
const { validateSchedule } = await import("../lib/elections/schedule");

const election = await getElection("board-2027");
if (!election) throw new Error("board-2027 not found");

console.log("ELECTION");
console.log(`  ${election.slug} — ${election.seatsAvailable} seats — status ${election.status}`);
console.log(`  AGM ${election.schedule.agmDate}`);
console.log(`  nominations  ${election.schedule.nominationsOpenAt} → ${election.schedule.nominationsCloseAt}`);
console.log(`  ballots      ${election.schedule.ballotsOpenAt} → ${election.schedule.ballotsCloseAt}`);
const problems = validateSchedule(election.schedule);
console.log(`  schedule coherent: ${problems.length === 0 ? "yes" : problems.join("; ")}`);
console.log(`  rule: ${election.config.eligibility.voterRule} · term cap ${election.config.candidacy.maxConsecutiveTerms}`);

console.log("\nELIGIBILITY (live)");
const { summary, verdicts } = await evaluateElectionEligibility(election.id);
console.log(`  organizations evaluated ... ${summary.total}`);
console.log(`  current members ........... ${summary.currentMembers}  (${summary.notCurrentMembers} former, excluded)`);
console.log(`  eligible today ............ ${summary.eligible}`);
console.log(`  ineligible ............... ${summary.ineligible}`);
console.log(`  → recoverable by renewing . ${summary.recoverableByRenewing}`);
console.log(`  by reason:`, summary.byReason);

const RECOVERABLE = new Set(["renewal_outstanding", "membership_expires_before_agm"]);
const blocked = verdicts.filter((v) => !v.isEligible && !RECOVERABLE.has(v.reasonCode));
console.log(`  ineligible for a reason the member CANNOT fix: ${blocked.length}`);

console.log("\nTERM CAP (from seeded history)");
const { createAdminClient } = await import("../lib/supabase/admin");
const db = createAdminClient();
const { data: seats } = await db
  .from("election_seats")
  .select("incumbent_profile_id, profiles:incumbent_profile_id(display_name)")
  .eq("election_id", election.id);

for (const s of seats ?? []) {
  const name = (s.profiles as { display_name: string } | null)?.display_name ?? "?";
  const served = await countConsecutiveTerms(
    election.bodyId,
    s.incumbent_profile_id as string,
    null
  );
  const cap = election.config.candidacy.maxConsecutiveTerms;
  const verdict =
    served === null ? "NO HISTORY — unverifiable" : served >= (cap ?? Infinity) ? "BARRED" : "may stand";
  console.log(`  ${name.padEnd(24)} served ${served} → ${verdict}`);
}

console.log("\nCOMMITTEE REVIEW (live)");
const { getCommitteeReview } = await import("../lib/elections/service");
const review = await getCommitteeReview("board-2027");
if (!review) throw new Error("review not assembled");

console.log(`  nominations ............... ${review.nominations.length}`);
console.log(`  validated ................. ${review.validated.length}`);
console.log(`  accepted but incomplete ... ${review.incomplete.length}`);
console.log(`  days to nominations close . ${review.daysUntilNominationsClose}`);
console.log(`  projected ................. ${review.projected.outcome}`);
console.log(`     ${review.projected.reason}`);
console.log(
  `  electorate ................ ${review.eligibility.eligible}/${review.eligibility.currentMembers} current members eligible · ${review.eligibility.recoverableByRenewing} one renewal away · ${review.eligibility.notCurrentMembers} former members excluded`
);

console.log("\n  Representation — nominees / eligible members");
for (const d of review.representation.dimensions) {
  const buckets = [...new Set([...Object.keys(d.membership), ...Object.keys(d.nominees)])].sort();
  const cells = buckets
    .map((b) => `${b}: ${d.nominees[b] ?? 0}/${d.membership[b] ?? 0}`)
    .join("  ");
  console.log(`    ${d.label.padEnd(17)} ${cells}${d.containsDerivedValues ? "   [derived]" : ""}`);
  if (d.unrepresented.length) console.log(`      no nominee from: ${d.unrepresented.join(", ")}`);
}

console.log("\nEMAIL TEMPLATES");
// Renders every election template with representative values and fails on any
// placeholder that survives. A mistyped variable name ships a literal
// "{{accept_url}}" to a member's inbox and there is no way to recall it.
const { getTemplate, renderTemplateContent } = await import("../lib/comms/templates");

const SAMPLE: Record<string, string | number> = {
  contact_name: "Sam Willis",
  nominee_name: "Sam Willis",
  nominator_org: "Lakeland College",
  nominee_org: "Lakeland College",
  organization_name: "Lakeland College",
  cycle_year: 2027,
  seats_available: 4,
  agm_date: "January 21, 2027",
  nominations_close: "October 23, 2026",
  ballots_open: "November 22, 2026",
  accept_url: "https://example.org/elections/accept/TOKEN",
  cosign_url: "https://example.org/elections/cosign/TOKEN",
  permission_url: "https://example.org/elections/accept/TOKEN",
  nominate_url: "https://example.org/elections/board-2027/nominate",
  outstanding_html: "<ul><li>A biography is required.</li></ul>",
  app_url: "https://example.org",
};

const ELECTION_TEMPLATES = [
  "election_call_for_nominations",
  "election_nomination_received",
  "election_cosign_request",
  "election_store_permission_request",
  "election_nomination_ready",
  "election_nomination_incomplete",
] as const;

let templateProblems = 0;
for (const key of ELECTION_TEMPLATES) {
  const template = await getTemplate(key);
  if (!template) {
    console.log(`  MISSING  ${key}`);
    templateProblems++;
    continue;
  }
  const { subject, bodyHtml } = renderTemplateContent(template, SAMPLE);
  const leftover = [...`${subject} ${bodyHtml}`.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map(
    (m) => m[1]
  );
  const unique = [...new Set(leftover)];
  if (unique.length) {
    console.log(`  UNRENDERED  ${key} → ${unique.join(", ")}`);
    templateProblems++;
  } else {
    console.log(`  ok  ${key}  ·  transactional=${template.is_transactional}  ·  "${subject}"`);
  }
}
console.log(templateProblems === 0 ? "  all templates render clean" : `  ${templateProblems} PROBLEM(S)`);

console.log("\nCALL FOR NOMINATIONS — reach");
const { createAdminClient: adminClient } = await import("../lib/supabase/admin");
const db2 = adminClient();
const { data: eligibleOrgs } = await db2
  .from("election_eligibility")
  .select("organization_id")
  .eq("election_id", election.id)
  .eq("is_eligible", true);
const orgIds = (eligibleOrgs ?? []).map((r) => r.organization_id as string);
const { data: admins } = await db2
  .from("user_organizations")
  .select("user_id, organization_id")
  .in("organization_id", orgIds.length ? orgIds : ["00000000-0000-0000-0000-000000000000"])
  .eq("role", "org_admin")
  .eq("status", "active");
const { data: reachable } = await db2
  .from("contacts")
  .select("id, email, organization_id")
  .in("organization_id", orgIds.length ? orgIds : ["00000000-0000-0000-0000-000000000000"])
  .in("profile_id", (admins ?? []).map((a) => a.user_id as string));
const withEmail = (reachable ?? []).filter((c) => (c.email as string)?.trim());
console.log(`  eligible institutions ..... ${orgIds.length}`);
console.log(`  admin contacts ............ ${(reachable ?? []).length}`);
console.log(`  reachable by email ........ ${withEmail.length}`);
console.log(`  admin contacts WITHOUT an email address: ${(reachable ?? []).length - withEmail.length}`);

console.log("\nAGM NOTICES (By-Law Part VII)");
const { getNoticeState } = await import("../lib/elections/service");
const ns = (await getNoticeState("board-2027"))!;
console.log(`  notice window ............. ${ns.window.opensOn} → ${ns.window.closesOn}`);
console.log(`  proxy form due ............ ${ns.window.proxyDueOn}`);
console.log(`  both in one send between .. ${ns.window.combinedFrom} and ${ns.window.combinedTo}`);
console.log(`  members to notify ......... ${ns.recipients}`);
console.log(`  unreachable ............... ${ns.unreachable.length}${ns.unreachable.length ? ": " + ns.unreachable.join(", ") : ""}`);
console.log(`  today ..................... ${ns.notice.code} — ${ns.notice.message}`);
console.log(`  proxy ..................... ${ns.proxy.message}`);

for (const key of ["agm_notice_of_meeting", "agm_proxy_form"] as const) {
  const t = await getTemplate(key);
  if (!t) { console.log(`  MISSING ${key}`); continue; }
  const { subject, bodyHtml } = renderTemplateContent(t, {
    ...SAMPLE,
    agm_date: "2027-01-21",
    agm_date_long: "Thursday, January 21, 2027",
    agm_time: "1:00 PM Eastern",
    location_clause: ", online",
    late_note: "",
  });
  const left = [...`${subject} ${bodyHtml}`.matchAll(/\{\{\s*([a-z0-9_#\/]+)\s*\}\}/gi)].map((m) => m[1]);
  console.log(`  ${left.length ? "UNRENDERED " + [...new Set(left)].join(",") : "ok"}  ${key} · "${subject}"`);
}
