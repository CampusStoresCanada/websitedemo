/**
 * The spine: a meeting of the members as ONE ordered list of stages.
 *
 * Lives in `lib/governance/` because it belongs to the MEETING. It was in
 * `lib/elections/timeline.ts` for as long as the AGM was reachable only by
 * opening an election, which is history rather than design — the meeting is the
 * activity and the election is business at it. The stage VOCABULARY
 * (`TimelineStage`, `StageState`) stays in `lib/elections/timeline.ts`: it is
 * shared with benchmarking and the admin calendar, so it is not the elections
 * module's to own either, and moving it would touch benchmarking's imports
 * while the FY2026 cycle is still collecting. That is a wart to finish after
 * 2026-11-20, not a reason to leave the builder in the wrong place.
 *
 * The screen renders this list; it does not decide the order. Each stage says
 * what it is waiting for and, when something can be done, which action does it.
 *
 * ⛔ Do not add a progress box, gap list or status summary beside the spine on
 * any screen. If a step is missing, add a STAGE. Three competing progress
 * narratives for one activity is what this replaced.
 *
 * Pure. Callers supply the facts and the date.
 */

import {
  BALLOT_CIRCULATION_DEADLINE_DAYS_BEFORE_AGM,
  candidatesMayBeTold,
} from "@/lib/elections/schedule";
import type { TimelineStage } from "@/lib/elections/timeline";

function day(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/**
 * The election held AT a meeting. Null for a members' meeting that has none.
 *
 * ⛔ Nested rather than flattened into TimelineFacts on purpose. A special
 * members' meeting is called with no election at all, and when these were flat
 * every one of them was non-optional — so the spine could not be built for such
 * a meeting, and the fix would have been a pile of `!` assertions waiting to
 * crash on the first one somebody called. Nesting makes the compiler ask.
 */
export interface ElectionFacts {
  cycleYear: number;
  status: string;
  outcome: "acclaimed" | "balloted" | null;
  schedule: {
    agmDate: string;
    nominationsOpenAt: string;
    nominationsCloseAt: string;
    ballotsOpenAt: string;
    ballotsCloseAt: string;
  };
  callSentAt: string | null;
  ballotsCirculatedAt: string | null;
  resultsAnnouncedAt: string | null;
  /** When the candidates were told their own result, ahead of the membership. */
  candidateResultsSentAt: string | null;
  certifiedAt: string | null;
  /**
   * Whether the ballots are sealed. A boolean rather than a timestamp because
   * `election_ballots_sealed` deliberately carries no per-row time — a sealing
   * timestamp could be correlated with voting order and re-identify a ballot.
   */
  sealed: boolean;
  nominationsReceived: number;
  validatedNominees: number;
  ballotsReturned: number;
  electorate: number;
}

/**
 * The facts a meeting's spine is built from.
 *
 * The MEETING half is always present — this is a meeting's spine, and every
 * members' meeting has an event page, a notice window, a proxy deadline, an
 * agenda and a package whether or not directors are elected at it. Those dates
 * all derive from the day the meeting sits, not from any election:
 * `resolveNoticeWindow(meetingDate)` is pure.
 */
export interface TimelineFacts {
  /** What the meeting is called, e.g. "2027 Annual General Meeting". */
  meetingLabel: string;
  /** The day it sits. Every window below is measured back from this. */
  meetingDate: string;
  /** The AGM's event page must be published before notice can be given. */
  eventPublished: boolean;
  /** Whether the event has a start time yet — publishing is blocked without one. */
  eventStartSet: boolean;
  /**
   * What is still missing from the meeting's event page, in prose.
   *
   * From `membersMeetingGaps`. These are the DETAIL of the publish stage, not a
   * list of their own: a second "still outstanding" box beside this spine is
   * the scattering this file exists to undo.
   */
  eventGaps: string[];
  /** Whether an agenda has been drafted onto the meeting record. */
  agendaDrafted: boolean;
  /** Notice window, from resolveNoticeWindow — derived from the meeting date. */
  noticeWindow: { opensOn: string; closesOn: string; proxyDueOn: string } | null;
  noticeSentAt: string | null;
  proxySentAt: string | null;
  packageSentAt: string | null;
  /** The election held at this meeting, or null when none is open. */
  election: ElectionFacts | null;
}

/**
 * Stages that are NOT a human act, and so are not on the timeline.
 *
 * Steve 2026-11-26: "if someone needs to do an action, it goes into the
 * timeline. If there's nothing for a human to do, then it isn't on the
 * timeline." And: "Things are clockwork and that's fine."
 *
 * Two kinds end up here.
 *
 * STATUS ONLY — `cycle_open`, `ballot`, `agm`. These never carried an action.
 * "Cycle opened" is a fact, "The slate is acclaimed, so there is no ballot" is
 * an explanation, and the meeting itself is an event that happens to you. A
 * list of things to do is not where any of them belong.
 *
 * ⛔ CLOCKWORK — `close_nominations`, `ballots_close`, `certify`. These were
 * presses, and nothing on them was ever a choice: the nomination and ballot
 * windows were published to members before anyone knew the result, and an
 * acclamation is nominees <= seats. A button at the end of the process is
 * discretion over WHEN a legally deadlined act happens, which is the thing an
 * auditor objects to. `lib/elections/clockwork.ts` runs them on the dates the
 * election already carries.
 *
 * ⛔ This is also what fixes the acclamation hole rather than papering over it.
 * `certify` was never pushed for an acclaimed slate — a test asserted its
 * ABSENCE — so the one act that writes the directors' terms appeared nowhere on
 * the page and was reachable only via a link named "Ballots & audit", for an
 * election in which no ballot was cast. The fix is not a better button. The
 * clock certifies, and there is no button to find.
 *
 * ⚠️ What this LOSES is the dates these stages displayed — "nominations close
 * 23 October". That belongs in a schedule-and-ledger reading of the cycle, which
 * is not built. It deliberately does NOT get bolted onto the timeline, because a
 * list that mixes "you must do this" with "this will happen to you" is the thing
 * being removed.
 */
const NOT_A_HUMAN_ACT = new Set([
  "cycle_open",
  "ballot",
  "agm",
  "close_nominations",
  "ballots_close",
  "certify",
]);

/**
 * Finished work moves below the live work.
 *
 * Steve: "when a timeline action is completed it gets moved away from the top of
 * the page so that going to the timeline shows you what is next."
 *
 * Stable within each half, so the order things happen in is preserved — this
 * only lifts what is still outstanding above what is not.
 */
function outstandingFirst(stages: TimelineStage[]): TimelineStage[] {
  const settled = (s: TimelineStage) => s.state === "done" || s.state === "not_applicable";
  return [...stages.filter((s) => !settled(s)), ...stages.filter(settled)];
}

export function buildMeetingSpine(
  facts: TimelineFacts,
  today: string
): TimelineStage[] {
  const stages: TimelineStage[] = [];
  const e = facts.election;

  // ⛔ Notice, the proxy form and the package are obligations of the MEETING —
  // their windows derive from its date, which is why they are in the meeting
  // half. But the senders are implemented against an election (they draw the
  // candidates and the committee's report from it), so for a members' meeting
  // with none there is nothing to press yet. Said plainly on the stage rather
  // than offered as a button that cannot succeed.
  const noElectionSend = e
    ? null
    : "Sending this is built from the election. For a members' meeting without one it has to go out by hand for now.";

  // ─── The election held at this meeting, when there is one ───────────
  if (e) {

      const acclaimed = e.outcome === "acclaimed";

    // 1 — Cycle opened.
    stages.push({
      key: "cycle_open",
      label: "Cycle opened",
      on: null,
      until: null,
      windowLabel: null,
      state: "done",
      detail: `The ${e.cycleYear} cycle exists, with the AGM set for ${e.schedule.agmDate}.`,
      action: null,
    });

    // 2 — Call for nominations. This is also what OPENS them; the two are one act.
    const callSent = day(e.callSentAt);
    stages.push({
      key: "call_for_nominations",
      label: "Call for nominations",
      on: e.schedule.nominationsOpenAt,
      until: null,
      windowLabel: null,
      state: callSent
        ? "done"
        : today >= e.schedule.nominationsOpenAt
          ? "overdue"
          : "upcoming",
      detail: callSent
        ? `Sent ${callSent}. Nominations are open.`
        : today >= e.schedule.nominationsOpenAt
          ? `Nominations were due to open ${e.schedule.nominationsOpenAt} and the call has not gone out — until it does, the nomination form turns members away.`
          : `Goes to every eligible institution and opens nominations.`,
      action: callSent
        ? null
        : { key: "sendCall", label: "Send the call for nominations", blockedBy: null },
    });

    // 3 — Nominations close.
    const nominationsClosed = !["draft", "nominating"].includes(e.status);
    stages.push({
      key: "close_nominations",
      label: "Nominations close",
      on: e.schedule.nominationsCloseAt,
      until: null,
      windowLabel: null,
      state: nominationsClosed
        ? "done"
        : today >= e.schedule.nominationsCloseAt
          ? "current"
          : "upcoming",
      detail: nominationsClosed
        ? `Closed. ${e.validatedNominees} validated nominee${e.validatedNominees === 1 ? "" : "s"} — ${acclaimed ? "acclaimed, no ballot" : "a ballot is required"}.`
        : `${e.nominationsReceived} nomination${e.nominationsReceived === 1 ? "" : "s"} received, ${e.validatedNominees} complete. Closing freezes the field.`,
      action: nominationsClosed
        ? null
        : {
            key: "closeNominations",
            label: "Close nominations",
            blockedBy:
              today < e.schedule.nominationsCloseAt
                ? `Not until ${e.schedule.nominationsCloseAt} — the window was published to members.`
                : null,
          },
    });

    // 4 — Balloting. Absent entirely when the slate is acclaimed.
    if (acclaimed) {
      stages.push({
        key: "ballot",
        label: "Ballot",
        on: null,
        until: null,
        windowLabel: null,
        state: "not_applicable",
        detail: "The slate is acclaimed, so there is no ballot.",
        action: null,
      });
    } else {
      const circulated = day(e.ballotsCirculatedAt);
      const allIn = e.electorate > 0 && e.ballotsReturned >= e.electorate;
      // The by-law's real constraint: the LAST day circulation may happen.
      const circulationDeadline = new Date(
        new Date(`${e.schedule.agmDate}T00:00:00Z`).getTime() -
          BALLOT_CIRCULATION_DEADLINE_DAYS_BEFORE_AGM * 86_400_000
      )
        .toISOString()
        .slice(0, 10);
      stages.push({
        key: "circulate_ballots",
        label: "Voting opens",
        on: e.schedule.ballotsOpenAt,
        until: null,
        windowLabel: `${e.schedule.ballotsOpenAt} to ${e.schedule.ballotsCloseAt}`,
        state: circulated
          ? "done"
          : e.status === "balloting"
            ? "current"
            : "upcoming",
        detail: circulated
          ? allIn
            ? // Information, not a trigger. It unlocks nothing, and the wording has
              // to stop anyone reading it as "voting is finished": eligibility is
              // resolved live, so a store clearing its renewal tomorrow joins the
              // electorate, and a returned ballot stays revisable until the close.
              `Circulated ${circulated}. All ${e.electorate} eligible institutions have returned a ballot. ` +
              `Voting still runs to ${e.schedule.ballotsCloseAt} — institutions may revise their ballot until then, and a store that ` +
              `becomes eligible before the close is entitled to vote.`
            : `Circulated ${circulated}. ${e.ballotsReturned} of ${e.electorate} institutions have voted.`
          : e.status === "balloting"
            ? `Ready now — the field was fixed when nominations closed. ${e.schedule.ballotsOpenAt} is the plan, not a gate: ` +
              `sending sooner only gives members longer to vote, and voting still closes ${e.schedule.ballotsCloseAt}. ` +
              `By-Law Part V S3(a) requires this by ${circulationDeadline}.`
            : `Tells every eligible institution that voting is open.`,
        action:
          e.status === "balloting" && !circulated
            ? { key: "circulateBallots", label: "Tell members voting is open", blockedBy: null }
            : e.status === "balloting"
              ? { key: "circulateBallots", label: "Remind those who have not voted", blockedBy: null }
              : null,
      });

      stages.push({
        key: "ballots_close",
        label: "Voting closes",
        on: e.schedule.ballotsCloseAt,
        until: null,
        windowLabel: null,
        state: e.sealed
          ? "done"
          : today >= e.schedule.ballotsCloseAt
            ? "current"
            : "upcoming",
        detail: e.sealed
          ? "Sealed. The link between institution and selection is gone."
          : "Sealing strips the link between institution and selection. It cannot be undone.",
        action: e.sealed
          ? null
          : {
              key: "sealElection",
              label: "Seal the ballots",
              blockedBy:
                today < e.schedule.ballotsCloseAt ? `Voting is open until ${e.schedule.ballotsCloseAt}.` : null,
            },
      });

      stages.push({
        key: "certify",
        label: "Count and certify",
        on: null,
        until: null,
        windowLabel: null,
        state: e.certifiedAt ? "done" : e.sealed ? "current" : "blocked",
        detail: e.certifiedAt
          ? `Certified ${day(e.certifiedAt)}.`
          : e.sealed
            ? "The scrutineer's count, reconciled against the roll."
            : "Waiting for the ballots to be sealed.",
        action: e.certifiedAt
          ? null
          : {
              key: "certifyElection",
              label: "Certify the result",
              blockedBy: e.sealed ? null : "The ballots are not sealed yet.",
            },
      });
    }
  }

  // 4b — The event page members are sent to.
  //
  // Notice links to it, so it has to be public before notice can be given.
  // That dependency was previously visible only as a `blockedBy` on the notice
  // stage, which told you that you were stuck without giving the thing you were
  // stuck on a place to be done. It is a stage of the meeting in its own right.
  const w = facts.noticeWindow;
  stages.push({
    key: "event_published",
    label: "The event page members see",
    on: null,
    // Due by the time notice can first be given, not by the meeting.
    until: w?.opensOn ?? null,
    windowLabel: null,
    state: facts.eventPublished
      ? "done"
      : w && today > w.opensOn
        ? "overdue"
        : "current",
    detail: facts.eventPublished
      ? "Published, so notice can link to it."
      : facts.eventGaps.length > 0
        ? facts.eventGaps.join(" ")
        : "Publishing it lets members see the meeting, mints the joining link for an online meeting, and unblocks notice.",
    action: facts.eventPublished
      ? null
      : {
          key: "publishEvent",
          label: "Publish the event page",
          blockedBy: facts.eventStartSet
            ? null
            : "Set the time the meeting starts — members have to be told when.",
        },
  });

  // 5 — Notice of meeting. A window, not a deadline.
  const noticeSent = day(facts.noticeSentAt);
  stages.push({
    key: "agm_notice",
    label: "Notice of the meeting",
    on: w?.opensOn ?? null,
    until: w?.closesOn ?? null,
    windowLabel: w ? `${w.opensOn} to ${w.closesOn}` : null,
    state: noticeSent
      ? "done"
      : w && today > w.closesOn
        ? "overdue"
        : w && today >= w.opensOn
          ? "current"
          : "upcoming",
    detail: noticeSent
      ? // ⚠️ Say so when it fell outside the window. The election's sender
        // refuses outside it, so this could only ever read "Given" — but notice
        // recorded BY HAND for a meeting with no election can carry any past
        // date, and a bare "Given" would present defective notice as
        // discharged. Part VII S4(b) is a window: too early is as defective as
        // too late.
        w && (noticeSent < w.opensOn || noticeSent > w.closesOn)
        ? `Given ${noticeSent} — OUTSIDE the ${w.opensOn} to ${w.closesOn} window, so the meeting may not be properly called.`
        : `Given ${noticeSent}.`
      : !facts.eventPublished
        ? "The meeting's event page is not published, so the link in the notice would show members nothing."
        : w
          ? `By-Law Part VII S4(b) — 21 to 35 days before the meeting. Too early is as defective as too late.`
          : "",
    action: noticeSent
      ? null
      : {
          key: "sendAgmNotice",
          label: "Give notice of the meeting",
          blockedBy: !facts.eventPublished
            ? "Publish the meeting's event page first."
            : w && today < w.opensOn
              ? `The window opens ${w.opensOn}.`
              : noElectionSend,
        },
  });

  // 6 — Proxy form, its own deadline.
  const proxySent = day(facts.proxySentAt);
  stages.push({
    key: "proxy_form",
    label: "Proxy form",
    on: w?.proxyDueOn ?? null,
    until: null,
    windowLabel: null,
    state: proxySent
      ? "done"
      : w && today > w.proxyDueOn
        ? "overdue"
        : "upcoming",
    detail: proxySent
      ? `Sent ${proxySent}.`
      : `By-Law Part VII S7(b) — members must have it 30 days before the meeting.`,
    action: proxySent
      ? null
      : { key: "sendProxyForm", label: "Send the proxy form", blockedBy: noElectionSend },
  });

  // 6b — The agenda.
  //
  // Before the package, because the agenda goes INSIDE the package: sending the
  // package without one is sending members a meeting they cannot follow. The
  // press is in the package panel; this stage is what makes the ordering
  // visible rather than something you discover from a missing item.
  // Without a notice window there is nothing to key the season off, so a
  // meeting with no election leaves the package upcoming until one opens.
  const packageSeason = w
    ? today >= w.opensOn
    : e
      ? today >= e.schedule.ballotsCloseAt
      : false;
  stages.push({
    key: "agenda",
    label: "Agenda for the meeting",
    on: null,
    until: null,
    windowLabel: null,
    state: facts.agendaDrafted ? "done" : packageSeason ? "current" : "upcoming",
    detail: facts.agendaDrafted
      ? "Drafted onto the meeting record."
      : "Generated from the chair's script so the two cannot drift, then edited by hand if the board wants it different.",
    action: facts.agendaDrafted
      ? null
      : {
          key: "generateAgenda",
          label: "Generate the agenda",
          blockedBy: e
            ? null
            : "The agenda is generated from the chair's script for an election. Draft it by hand on the meeting record for now.",
        },
  });

  // 7 — The members' package.
  const packageSent = day(facts.packageSentAt);
  // Only "current" once the meeting is actually being prepared. Marked current
  // year-round it becomes the headline in August, ahead of the call for
  // nominations that is the real next act — which is exactly backwards for a
  // screen whose job is to say what to do now.
  stages.push({
    key: "agm_package",
    label: "Members' AGM package",
    on: null,
    until: null,
    windowLabel: null,
    state: packageSent ? "done" : packageSeason ? "current" : "upcoming",
    detail: packageSent
      ? `Sent ${packageSent}.`
      : "Agenda, minutes, financial statements, the committee's report and the candidates.",
    action: packageSent
      ? { key: "sendAgmPackage", label: "Send it again", blockedBy: noElectionSend }
      : { key: "sendAgmPackage", label: "Send the package", blockedBy: noElectionSend },
  });

  // 8 — The meeting.
  stages.push({
    key: "agm",
    label: facts.meetingLabel,
    on: facts.meetingDate,
    until: null,
    windowLabel: null,
    state: today > facts.meetingDate ? "done" : today === facts.meetingDate ? "current" : "upcoming",
    detail:
      today > facts.meetingDate
        ? "The meeting has taken place."
        : e
          ? "The members elect the board at this meeting."
          : "A meeting of the members, under By-Law Part VII.",
    action: null,
  });

  // ─── Back to the election: the result, after the meeting ────────────
  if (e) {
    // 9 — The candidates, before the membership. A broadcast to every eligible
    // institution is the worst way to learn you were not elected.
    const candidatesTold = day(e.candidateResultsSentAt);
    // ⛔ The one answer, shared with the clock. See candidatesMayBeTold.
    const mayTell = candidatesMayBeTold({
      outcome: e.outcome,
      meetingDate: facts.meetingDate,
      asOf: today,
    });
    stages.push({
      key: "tell_candidates",
      label: "Tell the candidates",
      on: null,
      until: null,
      windowLabel: null,
      state: candidatesTold ? "done" : e.certifiedAt && mayTell ? "current" : "blocked",
      detail: candidatesTold
        ? `Told ${candidatesTold}.`
        : "Each candidate hears their own result before the membership does — a separate message to those elected and those not. Neither carries vote counts.",
      action: candidatesTold
        ? null
        : {
            key: "notifyCandidates",
            label: "Tell the candidates",
            blockedBy: !e.certifiedAt
              ? "The result is not certified."
              : !mayTell
                ? `Not until the meeting on ${facts.meetingDate}.`
                : null,
          },
    });

    // 9 — Announcing. Only after the meeting, because the meeting is what elects.
    const announced = day(e.resultsAnnouncedAt);
    stages.push({
      key: "announce_result",
      label: "Announce the result",
      on: null,
      until: null,
      windowLabel: null,
      state: announced ? "done" : today >= facts.meetingDate ? "current" : "blocked",
      detail: announced
        ? `Announced ${announced}.`
        : today >= facts.meetingDate
          ? "Tell the membership who the members elected."
          : "The members elect at the meeting, so there is nothing to announce until it has happened.",
      action: announced
        ? null
        : {
            key: "announceResults",
            label: "Announce the result",
            blockedBy: !e.certifiedAt
              ? "The result is not certified."
              : today < facts.meetingDate
                ? `Not until the meeting on ${facts.meetingDate}.`
                : null,
          },
    });
  }

  // ⛔ The timeline is what a HUMAN must do, in the order the next thing comes
  // first. Everything else — status, and anything the clock owns — is not a
  // to-do and is not here. See NOT_A_HUMAN_ACT.
  return outstandingFirst(stages.filter((stage) => !NOT_A_HUMAN_ACT.has(stage.key)));
}
