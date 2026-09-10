/**
 * RUN THE SCHEDULER ON THIS MACHINE, as hard as you like.
 *
 *   npx tsx --env-file=.env.local scripts/schedule-search.ts <conferenceId> [options]
 *
 *     --until-cold          draw until it stops improving (DEFAULT)
 *     --patience N          consecutive non-improving draws before stopping (default 150,
 *                           measured — see the constant for why it is not 50)
 *     --no-ils              disable iterated local search (reproduces old runs)
 *     --pref-pct N          how far up the score range a stated pick is worth (default 0.90)
 *     --max-ms N            wall-clock backstop
 *     --max-draws N         draw-count backstop
 *     --restarts N          fixed count instead of convergence
 *     --swap-trials N       how far each draw explores (default 40000)
 *     --extend-run ID       LATE ADD: extend that run instead of solving fresh
 *     --extend-active       LATE ADD: extend this conference's promoted run
 *     --persist             write the winner as a DRAFT run
 *
 * The January 18 freeze wants convergence, not a count: "let it cool until it
 * stops coming up with better solves." A fixed N either stops mid-climb or
 * burns hours after the plateau, and which one you get depends on the data.
 *
 * ⛔ Why this exists: drawing many schedules and keeping the best is CPU-bound
 * arithmetic, and the admin button runs it inside an HTTP request. That caps the
 * search at whatever a request timeout tolerates, which is the wrong ceiling for
 * the one lever that most improves the result. Steve: "there is an M1 Max
 * sitting here waiting to crush numbers instead of just relying on someone
 * else's celeron in the cloud."
 *
 * ⛔ It calls `runSchedulerSearch`, the SAME function the server action calls.
 * A local script that rebuilt the assembly would be a second scheduler, and a
 * local run that disagreed with the button would be worse than no local run.
 *
 * Defaults to a DRY RUN: it prints what it found and writes nothing. `--persist`
 * is required to create the draft run, and it never activates one — publishing a
 * schedule stays a human act behind the admin UI.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMeetingCandidates } from "@/lib/conference/meeting-candidates";
import { sendSchedulesForRun } from "@/lib/conference/schedule-delivery";
import { loadMeetingMatchScores, toSolverRecords } from "@/lib/conference/meeting-match-scores";
import { loadConferenceMeetingGeometry } from "@/lib/conference/meeting-geometry-loader";
import { buildSuiteOrgAssignmentsBySuiteId } from "@/lib/conference/suite-assignment";
import { runSchedulerSearch } from "@/lib/scheduler/run-search";
import { getActivePolicySet, getSchedulingConfig } from "@/lib/policy/engine";
import type { MeetingSlotInput } from "@/lib/scheduler/types";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=")[1];
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? (process.argv[idx + 1] ?? null) : null;
}

/**
 * The meetings of a frozen run, in solver shape.
 *
 * ⚠️ matchScoreKeys come back EMPTY and that is correct: they are not stored on
 * `schedules` and cannot be reconstructed. They are only used to attach score
 * provenance to NEW meetings, and a carried-over meeting keeps the score ids the
 * original run recorded.
 */
async function loadFrozenRun(
  db: ReturnType<typeof createAdminClient>,
  runId: string,
  exhibitorSeats: Map<string, { orgId: string; suiteId: string }>
) {
  const { data, error } = await db
    .from("schedules")
    .select("meeting_slot_id, exhibitor_seat_id, delegate_seat_ids")
    .eq("scheduler_run_id", runId)
    .eq("status", "scheduled");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(`run ${runId} has no scheduled meetings — nothing to extend`);
  }
  return data.map((row) => ({
    meetingSlotId: row.meeting_slot_id as string,
    exhibitorSeatId: row.exhibitor_seat_id as string,
    exhibitorOrganizationId:
      exhibitorSeats.get(row.exhibitor_seat_id as string)?.orgId ?? "",
    delegateSeatIds: (row.delegate_seat_ids as string[] | null) ?? [],
    matchScoreKeys: [] as string[],
  }));
}

async function main() {
  const conferenceId = process.argv[2];
  if (!conferenceId || conferenceId.startsWith("--")) {
    console.error(
      "usage: schedule-search.ts <conferenceId> [--patience N] [--swap-trials N] " +
        "[--pref-pct N] [--no-ils] [--restarts N] [--persist]\n" +
        "  late add: --extend-active | --extend-run <runId> — extend a frozen " +
        "schedule instead of solving a new one\n" +
        "  --allow-unscored: solve with no promoted match run (arbitrary pairings)\n" +
        "  --send: email the people whose schedule this is (needs --persist)\n" +
        "  --only-if-changed: on a late add, write nothing when nobody was seated\n" +
        "  --force: extend before the freeze date (normally refused)"
    );
    process.exit(1);
  }
  const fixedRestarts = arg("restarts");
  const persist = process.argv.includes("--persist");
  // Convergence is the default; a fixed count is the opt-out.
  const untilCold = fixedRestarts === null
    ? {
        /**
         * ⛔ 150, MEASURED — not a round number. 50 was a guess and it stops
         * the search while it is still climbing.
         *
         * Convergence run 2026-09-08 at the measured conference (31 suites ×
         * 23 times = 713 slots, 65 delegates, groups of 2–4, ILS 6, p90):
         * 885 draws, 144 improvements, converged, 43 min.
         *
         *   gaps between improvements: median 2, p90 9, p99 38, MAX 118
         *
         * ⚠️ THE 118 IS THE WHOLE POINT. A real improvement arrived after 118
         * consecutive failures, so any patience under ~120 can stop mid-climb
         * and call it convergence. What each setting would have produced:
         *
         *   patience  25 → stop draw 328, 87,945  (0.38% short, 17 min)
         *   patience  50 → stop draw 463, 88,083  (0.23% short, 25 min)
         *   patience  75 → stop draw 617, 88,281  (0.00% short, 34 min)
         *   patience 150 → ran to 885,    88,282  (converged,    43 min)
         *
         * The last real improvement was at draw 735; patience 50 would have
         * quit at 463, 272 draws early, and nothing in the output would have
         * said so — a truncated run and a converged one look identical from
         * the objective alone.
         *
         * 18 minutes on a machine that is otherwise idle, once a year, against
         * a schedule 65 people live with for a day. The trade is not close.
         *
         * ⚠️ ONE SEED, SYNTHETIC SCORES — production has no named seats yet.
         * Re-measure once seats are named; the 118 could be larger on real
         * data, and this default is a floor rather than a proven ceiling.
         */
        patience: Number(arg("patience") ?? 150),
        maxDraws: arg("max-draws") ? Number(arg("max-draws")) : undefined,
        maxMs: arg("max-ms") ? Number(arg("max-ms")) : undefined,
      }
    : undefined;
  const restarts = Number(fixedRestarts ?? 1);

  const db = createAdminClient();
  const t0 = Date.now();

  const [candidates, geometry, policy] = await Promise.all([
    loadMeetingCandidates(db, conferenceId),
    loadConferenceMeetingGeometry(conferenceId),
    getSchedulingConfig(),
  ]);

  const { data: suiteRows } = await db
    .from("conference_suites")
    .select("id, suite_number")
    .eq("conference_id", conferenceId)
    .order("suite_number", { ascending: true });
  const suites = (suiteRows ?? []).map((r) => ({
    id: r.id as string,
    suite_number: r.suite_number as number,
  }));

  const { data: slotRows } = await db
    .from("meeting_slots")
    .select("id, day_number, slot_number, suite_id")
    .eq("conference_id", conferenceId);
  const meetingSlots: MeetingSlotInput[] = (slotRows ?? []).map((s) => ({
    id: s.id as string,
    dayNumber: s.day_number as number,
    slotNumber: s.slot_number as number,
    suiteId: s.suite_id as string,
  }));

  const suiteOrgBySuiteId = buildSuiteOrgAssignmentsBySuiteId(
    suites,
    geometry.suiteOrgAssignmentsBySuiteNumber
  );

  // Only exhibitors whose org actually holds a suite can be scheduled — a booth
  // without a room does not get meetings.
  const orgsHoldingSuites = new Set(Object.values(suiteOrgBySuiteId));
  const exhibitors = candidates.exhibitors.filter((e: (typeof candidates.exhibitors)[number]) => orgsHoldingSuites.has(e.organizationId));

  const suitePinnedExhibitorBySuiteId: Record<string, string> = {};
  const used = new Set<string>();
  for (const suite of suites) {
    const orgId = suiteOrgBySuiteId[suite.id];
    if (!orgId) continue;
    const pick = exhibitors.find(
      (e: (typeof exhibitors)[number]) => e.organizationId === orgId && !used.has(e.registrationId)
    );
    if (!pick) continue;
    suitePinnedExhibitorBySuiteId[suite.id] = pick.registrationId;
    used.add(pick.registrationId);
  }

  const memberContacts = candidates.delegates
    .map((d: (typeof candidates.delegates)[number]) => ({
      orgId: d.organizationId,
      contactId: candidates.contactBySeatId.get(d.registrationId) ?? "",
    }))
    .filter((c: { orgId: string; contactId: string }) => c.contactId);
  const scores = await loadMeetingMatchScores(
    candidates.delegates.map((d: (typeof candidates.delegates)[number]) => d.organizationId),
    memberContacts
  );

  /**
   * ⛔ REFUSE TO SOLVE WITHOUT MATCH DATA.
   *
   * `available` is false when no match_run has status='promoted' — the engine
   * ran but nobody made a run live. Every orgTotalFor() then returns 0, so
   *
   *     matchTotal(e) × occupancy(e)  →  0 × occupancy
   *
   * and the objective collapses to occupancy alone: the solver packs rooms and
   * pairs people at random within the legal moves. It produces a complete,
   * confident-looking schedule that cannot answer "why did I get these five
   * meetings", because the answer is "no reason".
   *
   * ⚠️ This was computed and thrown away. `loadMeetingMatchScores` has always
   * returned `available`, and NOTHING read it — the one signal that separates
   * "misconfigured" from "working" was sitting unused next to the bug it
   * describes.
   *
   * `--allow-unscored` exists because the bench and any pre-promotion smoke test
   * legitimately have no promoted run. It must be typed deliberately.
   */
  if (!scores.available && !process.argv.includes("--allow-unscored")) {
    console.error(
      "refusing to solve: no promoted match run, so every pair scores 0 and the\n" +
        "objective collapses to occupancy alone — the schedule would be arbitrary.\n" +
        "  promote a match run first, or pass --allow-unscored to solve anyway."
    );
    process.exit(2);
  }
  if (!scores.available) {
    console.warn(
      "⚠️  --allow-unscored: no promoted match run. Pairings below are NOT matched."
    );
  }

  const delegateSeats = new Map(
    candidates.delegates.map((d: (typeof candidates.delegates)[number]) => [
      d.registrationId,
      { orgId: d.organizationId, contactId: candidates.contactBySeatId.get(d.registrationId) ?? null },
    ])
  );
  const exhibitorSeats = new Map<string, { orgId: string; suiteId: string }>();
  for (const [suiteId, seatId] of Object.entries(suitePinnedExhibitorBySuiteId)) {
    const e = exhibitors.find((x: (typeof exhibitors)[number]) => x.registrationId === seatId);
    if (e) exhibitorSeats.set(seatId, { orgId: e.organizationId, suiteId });
  }

  const loadedMs = Date.now() - t0;
  console.log(
    `loaded in ${loadedMs}ms — ${candidates.delegates.length} delegates, ` +
      `${exhibitors.length} schedulable exhibitors, ${suites.length} suites, ${meetingSlots.length} slots`
  );
  if (exhibitors.length === 0 || candidates.delegates.length === 0) {
    /**
     * ⚠️ This fires BEFORE the late-add block, so a late add on a conference
     * with no candidates reports "name some seats first" rather than anything
     * about runs. That is the right precondition — a schedule with no exhibitors
     * cannot be extended either — but the wording would mislead somebody in
     * January, so say which mode they are in.
     */
    const lateAdd =
      Boolean(arg("extend-run")) || process.argv.includes("--extend-active");
    console.error(
      lateAdd
        ? "nothing to extend — this conference has no schedulable exhibitors or " +
            "no delegates, so there is no schedule for a late arrival to join"
        : "nothing to schedule — name some seats first"
    );
    process.exit(2);
  }

  /**
   * LATE ADD — extend a frozen schedule instead of solving a new one.
   *
   * ⛔ Runs HERE, on this machine, for the same reason the full solve does:
   * cloud compute is a no when there is local compute to spare. This is not a
   * cheaper variant that earns an exception — it is the same engine with the
   * search turned off.
   *
   * The run it extends must already be promoted (or named explicitly), because
   * a late add is defined against the schedule people were actually sent.
   */
  let extendFrom: Awaited<ReturnType<typeof loadFrozenRun>> | undefined;
  const extendRunArg = arg("extend-run");
  if (extendRunArg || process.argv.includes("--extend-active")) {
    let runId = extendRunArg;
    if (!runId) {
      const { data: active } = await db
        .from("scheduler_runs")
        .select("id")
        .eq("conference_id", conferenceId)
        .eq("run_mode", "active")
        .maybeSingle();
      if (!active) {
        console.error(
          "no promoted run for this conference — a late add extends the schedule " +
            "people were sent, so there must be one. Solve and promote first."
        );
        process.exit(2);
      }
      runId = active.id as string;
    }

    /**
     * ⛔ A LATE ADD IS A POST-FREEZE OPERATION BY DEFINITION. Before the freeze
     * nothing has been sent, so the right move is a full re-solve — which finds
     * a better schedule and costs nobody a change, because nobody has been told
     * one yet. Running late-add early quietly locks in a worse schedule and
     * makes the freeze meaningless.
     */
    const { data: conf } = await db
      .from("conference_instances")
      .select("schedule_freeze_at")
      .eq("id", conferenceId)
      .maybeSingle();
    const freezeAt = (conf as { schedule_freeze_at?: string | null } | null)?.schedule_freeze_at;
    if (!freezeAt) {
      console.error(
        "no schedule_freeze_at set on this conference — a late add is defined\n" +
          "relative to the freeze. Set it in the conference details form first."
      );
      process.exit(2);
    }
    if (new Date(freezeAt) > new Date() && !process.argv.includes("--force")) {
      console.error(
        `schedule does not freeze until ${freezeAt} — before then, re-solve in full\n` +
          "instead: a late add preserves a schedule nobody has been sent yet.\n" +
          "  pass --force to extend anyway."
      );
      process.exit(2);
    }
    extendFrom = await loadFrozenRun(db, runId!, exhibitorSeats);
    console.log(
      `late add: extending run ${runId} — ${extendFrom.length} existing meetings held fixed`
    );
  }

  const t1 = Date.now();
  const outcome = runSchedulerSearch({
    extendFrom,
    delegates: candidates.delegates,
    exhibitors,
    meetingSlots,
    matchScores: toSolverRecords({
      delegates: candidates.delegates,
      exhibitors,
      contactBySeatId: candidates.contactBySeatId,
      scores,
    }),
    policy: {
      delegateCoveragePct: policy.delegate_coverage_pct,
      meetingGroupMin: policy.meeting_group_min,
      meetingGroupMax: policy.meeting_group_max,
      orgCoveragePct: policy.org_coverage_pct,
      tiebreakMode: policy.tiebreak_mode,
      feasibilityRelaxation: policy.feasibility_relaxation,
    },
    suitePinnedExhibitorBySuiteId,
    delegateSeats,
    exhibitorSeats,
    orgTotalFor: scores.orgTotalFor,
    personTotalFor: scores.personTotalFor,
    orgPreferredFor: candidates.topChoices.orgPicked,
    personPreferredFor: candidates.topChoices.personPicked,
    orgTotals: scores.orgTotals,
    seed: Number(arg("seed") ?? 1),
    restarts,
    untilCold,
    onImprovement: ({ draw, value, elapsedMs }) =>
      console.log(`  draw ${draw}: new best ${value.toFixed(0)} (${(elapsedMs / 1000).toFixed(1)}s)`),
    /**
     * ⚠️ DEEP BY DEFAULT (40,000), unlike the library's 4,000. Every measured
     * convergence run used this depth; the shallower library default exists so
     * the admin button still returns something in seconds. A CLI run is not
     * competing with a request timeout, and depth is where the quality is.
     */
    maxSwapTrials: Number(arg("swap-trials") ?? 40000),
    // ⛔ Reproduces a pre-2026-09-08 run. ILS is +14% and four times faster.
    ils: process.argv.includes("--no-ils") ? false : undefined,
    preferencePercentile: arg("pref-pct") ? Number(arg("pref-pct")) : undefined,
  });
  const searchMs = Date.now() - t1;

  console.log(
    JSON.stringify(
      {
        mode: untilCold ? "until-cold" : "fixed",
        draws: outcome.draws ?? restarts,
        stoppedBecause: outcome.stoppedBecause,
        lastImprovementAt: outcome.lastImprovementAt,
        searchMs,
        winningSeed: outcome.winningSeed,
        objective: +outcome.objectiveValue.toFixed(1),
        spread: outcome.spread,
        meetings: outcome.assignments.length,
        pairings: outcome.assignments.reduce((n, a) => n + a.delegateSeatIds.length, 0),
        satisfiedPreferences: outcome.satisfiedPreferences,
        mutualPreferences: outcome.mutualPreferences,
        preferenceShare: +outcome.preferenceShare.toFixed(3),
        preferenceWeight: +outcome.preferenceWeight.toFixed(2),
        rescueMoves: outcome.rescueMoves,
        scoreDistribution: outcome.scoreDistribution,
        status: outcome.diagnostics.status,
      },
      null,
      1
    )
  );

  if (outcome.lateAdd) {
    const { newlySeated, alsoGained, stillWithoutMeetings, addedMeetings } = outcome.lateAdd;
    console.log("\nlate add:");
    console.log(`  seated for the first time : ${newlySeated.length}`);
    console.log(`  new meetings opened       : ${addedMeetings}`);
    /**
     * ⛔ Printed as an obligation, not a count. These delegates already had a
     * schedule and now have one more meeting on it — they need
     * conference_schedule_ready re-sent. Nothing sends it automatically yet.
     */
    console.log(
      `  ⛔ SCHEDULE NOW STALE      : ${alsoGained.length}` +
        (alsoGained.length ? ` — re-send to ${alsoGained.join(", ")}` : "")
    );
    console.log(
      `  still with no meetings    : ${stillWithoutMeetings.length}` +
        (stillWithoutMeetings.length
          ? ` — no under-full room and no legal companion; they wait for the next arrival`
          : "")
    );
  }

  if (!persist) {
    console.log("\ndry run — nothing written. pass --persist to create a draft run.");
    return;
  }

  /**
   * ⚠️ For the nightly. A late add that seated nobody has nothing to record, and
   * writing an identical draft run every night buries the one night that
   * mattered under thirteen that did not.
   */
  if (process.argv.includes("--only-if-changed") && outcome.lateAdd) {
    const { newlySeated, alsoGained, addedMeetings } = outcome.lateAdd;
    if (newlySeated.length + alsoGained.length + addedMeetings === 0) {
      console.log("\nnothing to add — no run written.");
      return;
    }
  }

  const activePolicySet = await getActivePolicySet();
  if (!activePolicySet) throw new Error("no active policy set — cannot record a reproducible run");

  const { data: run, error } = await db
    .from("scheduler_runs")
    .insert({
      conference_id: conferenceId,
      // Same policy set the run was scored against, so a persisted local run is
      // reproducible against the rules that produced it.
      policy_set_id: activePolicySet.id,
      run_seed: outcome.winningSeed,
      run_mode: "draft",
      status: "completed",
      total_delegates: candidates.delegates.length,
      total_exhibitors: exhibitors.length,
      total_meetings_created: outcome.assignments.length,
      metadata: {
        source: "local_cli",
        restart_spread: outcome.spread,
        preference_weight: outcome.preferenceWeight,
        satisfied_preferences: outcome.satisfiedPreferences,
        mutual_preferences: outcome.mutualPreferences,
        preference_share: outcome.preferenceShare,
        rescue_moves: outcome.rescueMoves,
        score_distribution: outcome.scoreDistribution,
      },
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(error?.message ?? "could not create run");

  const rows = outcome.assignments.map((a) => ({
    conference_id: conferenceId,
    scheduler_run_id: run.id,
    meeting_slot_id: a.meetingSlotId,
    exhibitor_seat_id: a.exhibitorSeatId,
    delegate_seat_ids: a.delegateSeatIds,
    status: "scheduled",
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: insertError } = await db.from("schedules").insert(rows.slice(i, i + 500));
    if (insertError) throw new Error(insertError.message);
  }

  // ⛔ DRAFT ONLY. Nothing here promotes a run — publishing a schedule to the
  // people in it stays a deliberate human act in the admin UI.
  console.log(`\npersisted draft run ${run.id} with ${rows.length} meetings (NOT activated)`);

  /**
   * ⛔ SENDING IS A SEPARATE, DELIBERATE ACT. Steve: "we hold it until we want
   * the final answer... we don't ship their schedule ASAP."
   *
   * So this never fires on its own. A late add that emailed on every run would
   * tell one latecomer their schedule four times in January while the people
   * around them got a fresh copy each time somebody else arrived. Batching is
   * the point, and the batch boundary is a human deciding it is time.
   *
   * ⚠️ On a LATE ADD it sends only to the people whose day actually changed —
   * `newlySeated` plus `alsoGained` — rather than re-announcing to the whole
   * conference. On a full solve it sends to everyone holding a seat.
   */
  if (!process.argv.includes("--send")) {
    console.log("  not sent. pass --send to email the people whose schedule this is.");
    return;
  }

  const audience = outcome.lateAdd
    ? [...outcome.lateAdd.newlySeated, ...outcome.lateAdd.alsoGained]
    : undefined;

  const delivery = await sendSchedulesForRun({
    db,
    conferenceId,
    runId: run.id,
    delegateSeatIds: audience,
  });

  console.log(
    `\nsent ${delivery.sent.length}` +
      (audience ? ` (late add: only those whose day changed)` : " (everyone with a seat)")
  );
  if (delivery.noEmail.length > 0) {
    console.log(
      `  ⚠️  ${delivery.noEmail.length} seat(s) have no email — they were NOT told: ` +
        delivery.noEmail.join(", ")
    );
  }
  if (delivery.unknownSeat.length > 0) {
    console.log(`  ⚠️  ${delivery.unknownSeat.length} seat id(s) matched no seat holding`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
