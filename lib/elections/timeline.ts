/**
 * The election cycle as one ordered list of stages, each with its date, its
 * state, and the action that moves it.
 *
 * The admin screen grew a stage at a time, so the controls ended up scattered
 * across panels in the order they were built rather than the order they happen.
 * That is fine while you already know the process and useless while you are
 * learning it — and this runs once a year, so nobody ever stops learning it.
 *
 * One spine, chronological, is the answer. Each stage says what it is waiting
 * for and, when something can be done, which action does it. The screen renders
 * the list; it does not decide the order.
 *
 * Pure. Callers supply the facts and the date.
 */

export type StageState =
  /** Finished, with the date it happened. */
  | "done"
  /** Actionable now. */
  | "current"
  /** Its date has passed and it did not happen. */
  | "overdue"
  /** Still ahead. */
  | "upcoming"
  /** Cannot happen until something else does. */
  | "blocked"
  /** Does not apply to this cycle. */
  | "not_applicable";

import { BALLOT_CIRCULATION_DEADLINE_DAYS_BEFORE_AGM } from "./schedule";

export interface TimelineStage {
  key: string;
  label: string;
  /** The date it happens or is due. A window uses `on` + `until`. */
  on: string | null;
  /**
   * The far end of a window, when this stage is one.
   *
   * ⛔ Real dates, not only the prose in `windowLabel`. A window has to be
   * missable from BOTH ends — the AGM notice is defective sent too early as
   * well as too late — and anything consuming a stage programmatically (the
   * admin calendar renders projected items with a start and an end) cannot get
   * that out of a label. `windowLabel` stays for display, so a screen keeps
   * saying "2026-12-17 to 2026-12-31" rather than re-formatting these.
   */
  until: string | null;
  windowLabel: string | null;
  state: StageState;
  /** What happened, or what it is waiting for. */
  detail: string;
  /** The action that moves this stage, when one is available now. */
  action: {
    key: string;
    label: string;
    /** Set when the action exists but cannot run yet. */
    blockedBy: string | null;
  } | null;
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

function day(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
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
    stages.push({
      key: "tell_candidates",
      label: "Tell the candidates",
      on: null,
      until: null,
      windowLabel: null,
      state: candidatesTold ? "done" : e.certifiedAt && today >= facts.meetingDate ? "current" : "blocked",
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
              : today < facts.meetingDate
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

  return stages;
}

/**
 * The one stage a person should look at first.
 *
 * Falls through to the next upcoming stage rather than returning nothing. In
 * the quiet months every stage is "upcoming", and a screen that answers "what
 * now?" with silence is worse than one that says "nothing yet — the call for
 * nominations goes out on 23 September."
 */
export function currentStage(stages: TimelineStage[]): TimelineStage | null {
  return (
    stages.find((st) => st.state === "overdue") ??
    stages.find((st) => st.state === "current" && st.action && !st.action.blockedBy) ??
    stages.find((st) => st.state === "current") ??
    stages.find((st) => st.state === "upcoming") ??
    null
  );
}
