/**
 * The election runs on the clock.
 *
 * Steve 2026-11-26: "if there's no human decision why would we make them human
 * decisions? Things are clockwork and that's fine." And a week earlier, on the
 * same point: "there shouldn't be buttons for this stuff. There should be during
 * set up. But at the end of the game? Nah. That's too late."
 *
 * A button at the end of the process is discretion over WHEN a legally deadlined
 * act happens. The integrity comes from the rule being fixed before anybody
 * knows the outcome, so these steps execute on dates the election already
 * carries, each of them published to members before the result existed:
 *
 *   nominations_close_at   printed in the call for nominations
 *   ballots_close_at       circulated with the ballot
 *   the acclamation        a consequence of nominees <= seats, not a judgement
 *
 * ⛔ NO NEW SCHEDULE TABLE. `conference_scheduled_transitions` holds rows a
 * person scheduled by hand; an election's dates are already on the election,
 * derived from the members' meeting connected to it. A second store holding the
 * same dates is how the two come to disagree.
 *
 * ⛔ EVERY STEP CALLS THE SAME GATED FUNCTION THE BUTTON CALLS. That is what
 * lets a manual act in the meantime win over the clock instead of being
 * clobbered, and it keeps the by-law gates in one place. `certifyElection`
 * already refuses an unresolved tie -- "By-Law No. 1 prescribes no tie-break" --
 * so a tie stops the clock and raises. That is correct: a tie is a real human
 * decision, and real decisions are what is left for people.
 *
 * ⛔ THIS SENDS NOTHING. Telling the candidates and announcing the result both
 * put mail in front of named people. Unattended delivery of a legally
 * significant message is its own failure mode: if it fails at 2am, notice is
 * defective and nobody knows. So the clock takes the election as far as
 * certification and then RAISES. The property wanted is "no discretion over the
 * date", not "no humans" -- the date is nobody's to choose, but somebody still
 * watches the mail go out.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { closeNominations, sealElection, certifyElection } from "@/lib/elections/service";
import { raiseAlertIfNotOpen } from "@/lib/ops/alerts";
import { logAuditEventSafe } from "@/lib/ops/audit";

export type ClockworkStepName = "close_nominations" | "seal_ballots" | "certify" | "tell_candidates";

export type ClockworkStep = {
  slug: string;
  step: ClockworkStepName;
  outcome: "advanced" | "blocked" | "waiting";
  detail: string;
};

export type ElectionClockworkRunResult = {
  considered: number;
  advanced: number;
  blocked: number;
  steps: ClockworkStep[];
};

export type ClockworkElection = {
  id: string;
  slug: string;
  status: string;
  outcome: string | null;
  nominationsCloseAt: string | null;
  ballotsCloseAt: string | null;
  meetingId: string | null;
  candidateResultsSentAt: string | null;
};

/**
 * Which step, if any, is DUE for this election as at `asOf` — pure, so the
 * decision can be tested without a database and shown on a screen without
 * running anything.
 *
 * Returns null when the clock has nothing to do: not yet due, in setup, already
 * finished, or waiting on a person.
 */
export function dueStep(e: ClockworkElection, asOf: string): ClockworkStepName | null {
  // ⛔ An election with no members' meeting connected has NO calendar — every
  // date is the meeting date minus N days — so it cannot be past anything. It
  // is in setup, not late.
  if (!e.meetingId) return null;

  if (e.status === "nominating")
    return e.nominationsCloseAt && asOf >= e.nominationsCloseAt ? "close_nominations" : null;

  // Nominees <= seats is arithmetic. By-Law Part V S3(d) has the Chair announce
  // the acclamation at the meeting, which is a separate act from the slate being
  // final — this is the slate being final.
  if (e.status === "nominations_closed" && e.outcome === "acclaimed") return "certify";

  if (e.status === "balloting")
    return e.ballotsCloseAt && asOf >= e.ballotsCloseAt ? "seal_ballots" : null;

  if (e.status === "sealed") return "certify";

  if (e.status === "certified" && !e.candidateResultsSentAt) return "tell_candidates";

  return null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Advance every election whose next derivable step is due.
 *
 * `asOf` is for tests and for reading what today would do. ⛔ It is NOT a lever
 * for making something happen early: moving the clock is how a fixed deadline
 * turns back into somebody's discretion, which is the whole thing this replaces.
 */
export async function runElectionClockwork(opts?: {
  asOf?: string;
  /**
   * Limit the run to these slugs.
   *
   * A FILTER, not a date override: it can stop the clock reaching an election,
   * never make one happen early, so it cannot turn a fixed deadline back into
   * somebody's discretion. It exists because the runner cannot otherwise be
   * exercised against the real database without advancing the real election
   * sitting in it.
   */
  only?: string[];
}): Promise<ElectionClockworkRunResult> {
  const db = createAdminClient();
  const asOf = opts?.asOf ?? today();
  const result: ElectionClockworkRunResult = { considered: 0, advanced: 0, blocked: 0, steps: [] };

  const { data, error } = await db
    .from("elections")
    .select("id, slug, status, outcome, nominations_close_at, ballots_close_at, meeting_id, config")
    .order("cycle_year", { ascending: true });

  if (error) {
    await raiseAlertIfNotOpen({
      ruleKey: "election_clockwork_unreadable",
      severity: "critical",
      message: `The election clock could not read the elections table: ${error.message}`,
      details: { error: error.message },
    });
    return result;
  }

  const only = opts?.only ? new Set(opts.only) : null;

  for (const row of data ?? []) {
    if (only && !only.has(row.slug as string)) continue;

    const e: ClockworkElection = {
      id: row.id as string,
      slug: row.slug as string,
      status: row.status as string,
      outcome: (row.outcome as string | null) ?? null,
      nominationsCloseAt: (row.nominations_close_at as string | null) ?? null,
      ballotsCloseAt: (row.ballots_close_at as string | null) ?? null,
      meetingId: (row.meeting_id as string | null) ?? null,
      candidateResultsSentAt:
        ((row.config as { candidateResultsSentAt?: string } | null)?.candidateResultsSentAt as
          | string
          | undefined) ?? null,
    };

    const step = dueStep(e, asOf);
    if (!step) continue;
    result.considered += 1;

    if (step === "tell_candidates") {
      // The clock does not send. It makes the obligation impossible to miss.
      await raiseAlertIfNotOpen({
        ruleKey: `election_candidates_not_told:${e.slug}`,
        severity: "warning",
        message: `${e.slug} is certified and the candidates have not been told. Telling them is what opens an incoming director's access, so nothing downstream of it can happen until it is sent.`,
        details: { slug: e.slug, electionId: e.id },
      });
      result.steps.push({
        slug: e.slug,
        step,
        outcome: "waiting",
        detail: "Certified. Waiting for a person to send the result to the candidates.",
      });
      continue;
    }

    const ran =
      step === "close_nominations"
        ? await closeNominations(e.slug)
        : step === "seal_ballots"
          ? await sealElection(e.slug)
          : await certifyElection(e.slug, { certifiedByProfileId: null });

    const recorded = await record(e, step, ran);
    result.steps.push(recorded);
    if (recorded.outcome === "advanced") result.advanced += 1;
    if (recorded.outcome === "blocked") result.blocked += 1;
  }

  return result;
}

/** Turns a service Result into a step, an audit entry, and on failure an alert. */
async function record(
  e: ClockworkElection,
  step: ClockworkStepName,
  outcome: { ok: true; data: unknown } | { ok: false; error: string }
): Promise<ClockworkStep> {
  if (outcome.ok) {
    await logAuditEventSafe({
      // ⛔ No actor id, and actorType "cron". NOBODY did this; a rule fixed
      // before the outcome was known did. An id here would be a falsehood in
      // the record of a statutory act.
      actorId: null,
      actorType: "cron",
      action: `election_clockwork_${step}`,
      entityType: "election",
      entityId: e.id,
      details: { slug: e.slug, step, fromStatus: e.status },
    });
    return { slug: e.slug, step, outcome: "advanced", detail: "Ran on the clock." };
  }

  // ⛔ A STABLE rule key per election and step, deliberately NOT keyed by a
  // one-off id. An event-raised `*_failed:<uuid>` alert is silenced forever once
  // somebody resolves it, because nothing raises it again. This one is re-raised
  // every run while the condition holds, so resolving it without fixing it only
  // buys until the next run.
  await raiseAlertIfNotOpen({
    ruleKey: `election_clockwork_blocked:${e.slug}:${step}`,
    severity: "critical",
    message: `The election clock could not ${step.replace(/_/g, " ")} ${e.slug}: ${outcome.error}`,
    details: { slug: e.slug, electionId: e.id, step, status: e.status, error: outcome.error },
  });

  return { slug: e.slug, step, outcome: "blocked", detail: outcome.error };
}
