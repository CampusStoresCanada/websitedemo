/**
 * THE REAL CONFERENCE, not a convenient one.
 *
 *   npx tsx --env-file=.env.local scripts/bench-scheduler.ts [--delegates N]
 *
 * ⛔ THIS FILE EXISTS BECAUSE I KEPT MEASURING THE WRONG PROBLEM. Over one
 * afternoon I benchmarked with: a uniform score distribution (so every schedule
 * was interchangeable and restarts "proved" useless), a group minimum of 1 when
 * policy says 2, 150 delegates when 60-70 is realistic, and 12 suites when there
 * are 31. Each time the numbers were real and the conclusion was wrong, because
 * the conditions were not the ones CSC actually has.
 *
 * So the parameters below are the MEASURED conference, and anything concluded
 * about the scheduler should be re-run here before it is believed.
 *
 * Measured from production, 2026-09-03:
 *   31 suites x 23 distinct meeting times = 713 slots
 *   meeting_group_min 2, meeting_group_max 4  (policy_values)
 *   delegate_coverage_pct 0.75, org_coverage_pct 0.7
 *   60-70 delegates realistic; 159 is the stated ceiling and very unlikely
 *
 * ⚠️ The SCORES are still synthetic — production has no named seats yet — but
 * shaped to the match engine's measured distribution rather than pulled flat:
 * the embedding space reports p50 54.4, p75 77.8, every edge distinct.
 */
import { runSchedulerSearch } from "@/lib/scheduler/run-search";
import { describeTotals, DEFAULT_PREFERENCE_PERCENTILE } from "@/lib/scheduler/objective";
import { DEFAULT_ILS } from "@/lib/scheduler/run-search";
import type { DelegateProfile, ExhibitorProfile, MeetingSlotInput } from "@/lib/scheduler/types";

const SUITES = 31;
const TIMES = 23;
const GROUP_MIN = 2;
const GROUP_MAX = 4;
const MEMBER_ORGS = 52;
const CATEGORIES = 6;

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return Number(hit.split("=")[1]);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const DELEGATES = arg("delegates", 65);

const meetingSlots: MeetingSlotInput[] = [];
for (let s = 0; s < SUITES; s++)
  for (let t = 0; t < TIMES; t++)
    meetingSlots.push({ id: `slot-${s}-${t}`, dayNumber: 1 + Math.floor(t / 8), slotNumber: t, suiteId: `suite-${s}` });

const hash = (s: string) => { let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967295; };

/** A few exhibitors nearly everyone wants — the "get me University of Toronto" effect. */
const appeal = (e: number) => Math.pow(hash(`appeal-${e}`), 2.2);
const memberCat = (m: number) => m % CATEGORIES;
const exhibitorCat = (e: number) => Math.floor(hash(`cat-${e}`) * CATEGORIES);

function fit(memberOrgId: string, partnerOrgId: string): number {
  const m = Number(memberOrgId.split("-")[1]);
  const e = Number(partnerOrgId.split("-")[1]);
  if (!Number.isFinite(m) || !Number.isFinite(e)) return 0;
  const sameCategory = memberCat(m) === exhibitorCat(e) ? 1 : 0;
  return 28 + appeal(e) * 62 + sameCategory * 30 + hash(`n-${m}-${e}`) * 24;
}

const exhibitors: ExhibitorProfile[] = Array.from({ length: SUITES }, (_, i) => ({
  registrationId: `ex-${i}`, organizationId: `partner-${i}`, userId: `u-ex-${i}`,
  blackoutList: hash(`bl-${i}`) < 0.08 ? [`member-${i % MEMBER_ORGS}`] : [],
  primaryCategory: String(exhibitorCat(i)), secondaryCategories: [],
  buyingCyclesTargeted: [], meetingOutcomeIntent: [], salesReadiness: null,
}));
const delegates: DelegateProfile[] = Array.from({ length: DELEGATES }, (_, i) => ({
  registrationId: `d-${i}`, organizationId: `member-${i % MEMBER_ORGS}`, userId: `u-d-${i}`,
  categoryResponsibilities: [], buyingTimeline: [], topPriorities: [],
  meetingIntent: [], purchasingAuthority: null, top5Preferences: [], blackoutList: [],
}));

const delegateSeats = new Map(delegates.map((d) => [d.registrationId, { orgId: d.organizationId, contactId: `c-${d.registrationId}` }]));
const exhibitorSeats = new Map(exhibitors.map((e, i) => [e.registrationId, { orgId: e.organizationId, suiteId: `suite-${i}` }]));
const pinned: Record<string, string> = {};
exhibitors.forEach((e, i) => { pinned[`suite-${i}`] = e.registrationId; });

/** Top 5 both directions — members pick partners, partners pick members. */
const picks = new Set<string>();
for (let m = 0; m < MEMBER_ORGS; m++) {
  const ranked = [...Array(SUITES).keys()].sort((a, b) => appeal(b) + hash(`p-${m}-${b}`) - (appeal(a) + hash(`p-${m}-${a}`)));
  for (const e of ranked.slice(0, 5)) picks.add(`member-${m}|partner-${e}`);
}
for (let e = 0; e < SUITES; e++) {
  const ranked = [...Array(MEMBER_ORGS).keys()].sort((a, b) => hash(`q-${e}-${b}`) - hash(`q-${e}-${a}`));
  for (const m of ranked.slice(0, 5)) picks.add(`partner-${e}|member-${m}`);
}

const matchScores = delegates.flatMap((d) =>
  exhibitors.map((e) => ({
    delegateSeatId: d.registrationId, exhibitorSeatId: e.registrationId,
    exhibitorOrganizationId: e.organizationId,
    totalScore: fit(d.organizationId, e.organizationId),
    breakdown: {}, reasons: [], isBlackout: false, isTop5: false,
  }))
);
const orgTotals = delegates.flatMap((d) => exhibitors.map((e) => fit(d.organizationId, e.organizationId)));
const shape = describeTotals(orgTotals);

const supply = DELEGATES * TIMES;
const seatsNeededMin = meetingSlots.length * GROUP_MIN;
console.log(JSON.stringify({
  conference: { suites: SUITES, times: TIMES, slots: meetingSlots.length, groupMin: GROUP_MIN, groupMax: GROUP_MAX },
  delegates: DELEGATES,
  capacity: { personSlotSupply: supply, seatsToFillEverySlot: seatsNeededMin,
    canFillGrid: supply >= seatsNeededMin },
  scoreShape: { p50: +shape.p50.toFixed(1), p75: +shape.p75.toFixed(1),
    distinct: shape.distinct, preferenceWeight: +shape.weight.toFixed(1) },
}, null, 1));

function run(label: string, opts: { restarts?: number; swapTrials?: number; patience?: number; maxMs?: number; ils?: number; prefPct?: number }) {
  const t = Date.now();
  const out = runSchedulerSearch({
    delegates, exhibitors, meetingSlots, matchScores,
    policy: { delegateCoveragePct: 0.75, meetingGroupMin: GROUP_MIN, meetingGroupMax: GROUP_MAX,
              orgCoveragePct: 0.7, tiebreakMode: "seeded", feasibilityRelaxation: false },
    suitePinnedExhibitorBySuiteId: pinned, delegateSeats, exhibitorSeats,
    orgTotalFor: fit, personTotalFor: () => 0,
    orgPreferredFor: (declaring, chosen) => picks.has(`${declaring}|${chosen}`),
    personPreferredFor: () => false,
    orgTotals, seed: 1,
    restarts: opts.restarts ?? 1,
    maxSwapTrials: opts.swapTrials,
    ils: opts.ils ? { strength: opts.ils } : undefined,
    preferencePercentile: opts.prefPct,
    untilCold: opts.patience
      ? { patience: opts.patience, maxMs: opts.maxMs ?? 180_000 }
      : undefined,
    // The improvement curve is the whole point of a convergence run — seeing
    // WHEN the gains stop is what a final objective number cannot tell you.
    onImprovement: ({ draw, value, elapsedMs }) =>
      console.log(`  draw ${draw}: ${value.toFixed(0)}  (${(elapsedMs / 60000).toFixed(1)}min)`),
  });
  const seats = out.assignments.reduce((n, a) => n + a.delegateSeatIds.length, 0);
  const withMeetings = new Set(out.assignments.flatMap((a) => a.delegateSeatIds)).size;
  /**
   * ⛔ REPORT WHAT THE RUN ACTUALLY USED, never this file's own fallbacks.
   *
   * These read `opts.ils ?? 0` and `opts.prefPct ?? 0.75`, so a run that relied
   * on the library defaults recorded itself as "no ILS, upper quartile" while
   * having used ILS strength 6 and the top decile. The numbers were right and
   * the configuration line beside them was wrong — which is worse than no
   * record, because these lines get compared across runs weeks apart.
   *
   * Caught only because this run's results matched a flagged one exactly while
   * claiming different settings.
   */
  console.log(JSON.stringify({ label, ils: opts.ils ?? DEFAULT_ILS.strength, prefPct: opts.prefPct ?? DEFAULT_PREFERENCE_PERCENTILE, sec: +((Date.now() - t) / 1000).toFixed(1),
    draws: out.draws ?? opts.restarts ?? 1, stopped: out.stoppedBecause,
    objective: +out.objectiveValue.toFixed(0),
    spreadPct: +(((out.spread.best - out.spread.worst) / out.spread.worst) * 100).toFixed(2),
    meetings: out.assignments.length, occupancyPct: +((out.assignments.length / meetingSlots.length) * 100).toFixed(0),
    delegateSeats: seats, avgGroup: +(seats / out.assignments.length).toFixed(2),
    delegatesWithNoMeetings: DELEGATES - withMeetings,
    picksHonoured: out.satisfiedPreferences, mutual: out.mutualPreferences,
    prefSharePct: +(out.preferenceShare * 100).toFixed(1), rescues: out.rescueMoves }));
}

/**
 * ⛔ EVERY BOUNDED RUN REPORTS A LOWER BOUND, NOT A CEILING. Steve: "we actually
 * don't know the max and we won't under a bound test condition." Comparing "20
 * draws with swap" to "20 draws without" compares two arbitrary stopping points,
 * so any percentage between them is a statement about the budget, not the
 * algorithm. Only the convergence run below says where the search actually runs
 * out — and even that is a plateau, not a proven maximum.
 */
const COOK = process.env.COOK === "1";
if (!COOK) {
  run("1 draw, no swap", { restarts: 1, swapTrials: 0 });
  run("1 draw, swap", { restarts: 1 });
  run("20 draws, no swap", { restarts: 20, swapTrials: 0 });
  run("20 draws, swap", { restarts: 20 });
  run("20 draws, deep swap", { restarts: 20, swapTrials: 40000 });
} else {
  // Let it cook: deep search, high patience, hours-scale backstop.
  run(`cook (patience ${process.env.PATIENCE ?? 25})`, {
    patience: Number(process.env.PATIENCE ?? 25),
    swapTrials: Number(process.env.SWAP_TRIALS ?? 40000),
    maxMs: Number(process.env.MAX_MS ?? 4 * 60 * 60 * 1000),
    ils: process.env.ILS ? Number(process.env.ILS) : undefined,
    prefPct: process.env.PREF_PCT ? Number(process.env.PREF_PCT) : undefined,
  });
}
