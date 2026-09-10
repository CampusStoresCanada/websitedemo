#!/usr/bin/env npx tsx
/**
 * Phase 0 validation: run the match engine over real organizations and print
 * what it produces. Reads only — writes nothing, anywhere.
 *
 * Usage:
 *   npx tsx scripts/match-engine-preview.mts                 # every filled member
 *   npx tsx scripts/match-engine-preview.mts "University of British Columbia"
 *   npx tsx scripts/match-engine-preview.mts --direction partner_to_member
 *   npx tsx scripts/match-engine-preview.mts "Algonquin" --simulate "inclusive access,crewneck,lanyards"
 *
 * `--simulate` fabricates searches for the subject org, rolls them up through
 * the real signal pipeline, and shows the ranking before and after. Writes
 * nothing — it is how the loop gets proven without a migration or any live data.
 */
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const { createAdminClient } = await import("../lib/supabase/admin");
const { buildMatchProfile } = await import("../lib/match/profile");
const { rankCandidates } = await import("../lib/match/score");
const { reasonsVisibleTo } = await import("../lib/match/edge-view");
const { DEFAULT_MATCH_WEIGHTS } = await import("../lib/match/weights");
const { resolveText, RESOLVER_VERSION } = await import("../lib/signals/resolve");
const { rollupTerms, bestPerTerm, normalizeTermWeights, termKey } = await import("../lib/signals/aggregate");
const { VERB_PROFILES } = await import("../lib/signals/decay");
type SignalEvent = import("../lib/signals/types").SignalEvent;
type RevealedTerm = import("../lib/match/types").RevealedTerm;
type MatchDirection = import("../lib/match/types").MatchDirection;
type MatchProfile = import("../lib/match/types").MatchProfile;

const args = process.argv.slice(2);
const directionFlag = args.indexOf("--direction");
const direction: MatchDirection =
  directionFlag >= 0 ? (args[directionFlag + 1] as MatchDirection) : "member_to_partner";
const simulateFlag = args.indexOf("--simulate");
const simulatedQueries =
  simulateFlag >= 0 ? (args[simulateFlag + 1] ?? "").split(",").map((q) => q.trim()).filter(Boolean) : [];
const nameFilter = args.find(
  (a) => !a.startsWith("--") && a !== direction && a !== args[simulateFlag + 1]
);
const TOP = 5;

/**
 * Turn fabricated queries into revealed terms through the REAL pipeline —
 * resolve, weight, decay, roll up, normalise. Nothing is short-circuited, so
 * what this shows is what the nightly job would produce.
 */
function revealedFrom(orgId: string, queries: string[], now: Date): RevealedTerm[] {
  const events: SignalEvent[] = queries.flatMap((q, i) => {
    const { terms, source } = resolveText(q);
    // Three people, spread over the last few weeks, like a real store.
    return [0, 1, 2].map((n) => ({
      occurredAt: new Date(now.getTime() - (i * 5 + n * 3) * 86_400_000),
      source: "website" as const,
      verb: "searched" as const,
      actorOrgId: orgId,
      actorContactId: `person-${n}`,
      stance: "implicit" as const,
      polarity: "positive" as const,
      objectType: "query" as const,
      objectOrgId: null,
      objectRef: null,
      rawText: q,
      terms,
      termSource: source,
      resolverVersion: RESOLVER_VERSION,
      weight: VERB_PROFILES.searched.weight,
      dedupeKey: null,
    }));
  });

  const rolled = bestPerTerm(rollupTerms(events, now));
  const normalized = normalizeTermWeights(rolled);
  const unresolved = queries.filter((q) => resolveText(q).terms.length === 0);
  if (unresolved.length > 0) {
    console.log(`   ⚠️  resolved to nothing (kept as demand, feeds nothing yet): ${unresolved.join(", ")}`);
  }
  return rolled.map((r) => ({
    term: r.term,
    weight: normalized.get(termKey(r.organizationId, r.term)) ?? 0,
    source: r.termSource,
    actorCount: r.actorCount,
  }));
}

const COLUMNS =
  "id, name, type, primary_category, certifications, is_cancoll_member, province, " +
  "company_description, website_summary, fte, institution_type, procurement_info";

const db = createAdminClient();

async function load(type: string): Promise<MatchProfile[]> {
  const { data, error } = await db
    .from("organizations")
    .select(COLUMNS)
    .eq("type", type)              // ⚠️ capitalized — "Member" / "Vendor Partner"
    .eq("is_test", false)
    .is("archived_at", null);
  if (error) throw new Error(`${type}: ${error.message}`);
  return (data ?? [])
    .map((row) => buildMatchProfile(row as unknown as Parameters<typeof buildMatchProfile>[0]))
    .filter((p): p is MatchProfile => p !== null);
}

const members = await load("Member");
const partners = await load("Vendor Partner");

const pool = direction === "member_to_partner" ? partners : direction === "partner_to_member" ? members
  : direction === "member_to_member" ? members : partners;
const subjects = direction.startsWith("member") ? members : partners;

console.log(
  `\n${members.length} members · ${partners.length} partners · direction ${direction}\n` +
    `weights: ${JSON.stringify(DEFAULT_MATCH_WEIGHTS[direction])}\n`
);

// Order subjects by how much they have told us, so the richest records read first.
const filled = subjects
  .filter((s) => (nameFilter ? s.name.toLowerCase().includes(nameFilter.toLowerCase()) : true))
  .map((s) => ({
    subject: s,
    filledAxes:
      (s.departments.length ? 1 : 0) +
      (s.certificationsWanted.length || s.certificationsHeld.length ? 1 : 0) +
      (s.sourcingProvinces.length ? 1 : 0) +
      (s.buyingCycle ? 1 : 0) +
      (s.requirementsNotes ? 1 : 0) +
      (s.storeServices.length ? 1 : 0),
  }))
  .sort((a, b) => b.filledAxes - a.filledAxes)
  .filter((s) => (nameFilter ? true : s.filledAxes >= 2));

if (filled.length === 0) {
  console.log("No subject matched. Try a name fragment, or a different --direction.");
  process.exit(0);
}

const NOW = new Date();

for (const { subject, filledAxes } of filled) {
  const ranked = rankCandidates(subject, pool, direction).slice(0, TOP);
  console.log(`\n━━ ${subject.name}  (${filledAxes}/6 axes stated)`);
  const stated = [
    subject.departments.length ? `carries ${subject.departments.join(", ")}` : null,
    subject.certificationsWanted.length ? `wants ${subject.certificationsWanted.join(", ")}` : null,
    subject.sourcingProvinces.length ? `sources ${subject.sourcingProvinces.length} province(s)` : null,
    subject.buyingCycle ? "has a buying cycle" : null,
    subject.requirementsNotes ? "has requirements notes" : null,
    subject.storeServices.length ? `runs ${subject.storeServices.join(", ")}` : null,
  ].filter(Boolean);
  console.log(`   ${stated.join(" · ") || "nothing stated"}`);

  if (ranked.length === 0) {
    console.log("   no candidates");
    continue;
  }

  for (const pair of ranked) {
    const candidate = pool.find((p) => p.id === pair.candidateId)!;
    // The preview reads as the subject, so it filters as the subject would.
    const shown = reasonsVisibleTo(pair.reasons as never, subject.id);
    const hidden = pair.reasons.length - shown.length;
    console.log(
      `   ${String(pair.rank).padStart(2)}. ${candidate.name.padEnd(38).slice(0, 38)} ` +
        `score ${pair.score.toFixed(0).padStart(3)} · conf ${(pair.confidence * 100).toFixed(0).padStart(3)}% ` +
        `· rank ${pair.ranking.toFixed(1).padStart(5)}`
    );
    for (const reason of shown.slice(0, 3)) {
      console.log(`       [${reason.kind}] ${reason.text}`);
    }
    if (hidden > 0) console.log(`       (${hidden} reason(s) withheld by visibility settings)`);
  }

  if (simulatedQueries.length === 0) continue;

  console.log(`\n   ── with simulated searches: ${simulatedQueries.join(", ")} ──`);
  const revealedTerms = revealedFrom(subject.id, simulatedQueries, NOW);
  if (revealedTerms.length === 0) {
    console.log("   nothing resolved — ranking unchanged");
    continue;
  }
  console.log(`   revealed: ${revealedTerms.map((t) => `${t.term} ${t.weight.toFixed(2)}`).join(" · ")}`);

  const before = new Map(ranked.map((r) => [r.candidateId, r.rank]));
  const after = rankCandidates({ ...subject, revealedTerms }, pool, direction).slice(0, TOP);

  for (const pair of after) {
    const candidate = pool.find((p) => p.id === pair.candidateId)!;
    const was = before.get(pair.candidateId);
    const move = was === undefined ? "  NEW" : was === pair.rank ? "   ·  " : `${was > pair.rank ? "▲" : "▼"}${Math.abs(was - pair.rank)}`;
    console.log(
      `   ${move} ${String(pair.rank).padStart(2)}. ${candidate.name.padEnd(36).slice(0, 36)} ` +
        `score ${pair.score.toFixed(0).padStart(3)} · rank ${pair.ranking.toFixed(1).padStart(5)}`
    );
    const behavioural = reasonsVisibleTo(pair.reasons as never, subject.id).find((r) => r.kind === "behavioural");
    if (behavioural) console.log(`          [behavioural] ${behavioural.text}`);
  }
}

console.log();
