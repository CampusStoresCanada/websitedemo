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

export interface TimelineStage {
  key: string;
  label: string;
  /** The date it happens or is due. A window uses `windowLabel` instead. */
  on: string | null;
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

export interface TimelineFacts {
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
  noticeSentAt: string | null;
  proxySentAt: string | null;
  packageSentAt: string | null;
  resultsAnnouncedAt: string | null;
  certifiedAt: string | null;
  /**
   * Whether the ballots are sealed. A boolean rather than a timestamp because
   * `election_ballots_sealed` deliberately carries no per-row time — a sealing
   * timestamp could be correlated with voting order and re-identify a ballot.
   */
  sealed: boolean;
  /** Notice window, from resolveNoticeWindow. */
  noticeWindow: { opensOn: string; closesOn: string; proxyDueOn: string } | null;
  /** The AGM's event page must be published before notice can be given. */
  eventPublished: boolean;
  nominationsReceived: number;
  validatedNominees: number;
  ballotsReturned: number;
  electorate: number;
}

function day(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

export function buildElectionTimeline(
  facts: TimelineFacts,
  today: string
): TimelineStage[] {
  const s = facts.schedule;
  const stages: TimelineStage[] = [];

  const acclaimed = facts.outcome === "acclaimed";

  // 1 — Cycle opened.
  stages.push({
    key: "cycle_open",
    label: "Cycle opened",
    on: null,
    windowLabel: null,
    state: "done",
    detail: `The ${facts.cycleYear} cycle exists, with the AGM set for ${s.agmDate}.`,
    action: null,
  });

  // 2 — Call for nominations. This is also what OPENS them; the two are one act.
  const callSent = day(facts.callSentAt);
  stages.push({
    key: "call_for_nominations",
    label: "Call for nominations",
    on: s.nominationsOpenAt,
    windowLabel: null,
    state: callSent
      ? "done"
      : today >= s.nominationsOpenAt
        ? "overdue"
        : "upcoming",
    detail: callSent
      ? `Sent ${callSent}. Nominations are open.`
      : today >= s.nominationsOpenAt
        ? `Nominations were due to open ${s.nominationsOpenAt} and the call has not gone out — until it does, the nomination form turns members away.`
        : `Goes to every eligible institution and opens nominations.`,
    action: callSent
      ? null
      : { key: "sendCall", label: "Send the call for nominations", blockedBy: null },
  });

  // 3 — Nominations close.
  const nominationsClosed = !["draft", "nominating"].includes(facts.status);
  stages.push({
    key: "close_nominations",
    label: "Nominations close",
    on: s.nominationsCloseAt,
    windowLabel: null,
    state: nominationsClosed
      ? "done"
      : today >= s.nominationsCloseAt
        ? "current"
        : "upcoming",
    detail: nominationsClosed
      ? `Closed. ${facts.validatedNominees} validated nominee${facts.validatedNominees === 1 ? "" : "s"} — ${acclaimed ? "acclaimed, no ballot" : "a ballot is required"}.`
      : `${facts.nominationsReceived} nomination${facts.nominationsReceived === 1 ? "" : "s"} received, ${facts.validatedNominees} complete. Closing freezes the field.`,
    action: nominationsClosed
      ? null
      : {
          key: "closeNominations",
          label: "Close nominations",
          blockedBy:
            today < s.nominationsCloseAt
              ? `Not until ${s.nominationsCloseAt} — the window was published to members.`
              : null,
        },
  });

  // 4 — Balloting. Absent entirely when the slate is acclaimed.
  if (acclaimed) {
    stages.push({
      key: "ballot",
      label: "Ballot",
      on: null,
      windowLabel: null,
      state: "not_applicable",
      detail: "The slate is acclaimed, so there is no ballot.",
      action: null,
    });
  } else {
    const circulated = day(facts.ballotsCirculatedAt);
    stages.push({
      key: "circulate_ballots",
      label: "Voting opens",
      on: s.ballotsOpenAt,
      windowLabel: `${s.ballotsOpenAt} to ${s.ballotsCloseAt}`,
      state: circulated
        ? "done"
        : facts.status === "balloting"
          ? "current"
          : "upcoming",
      detail: circulated
        ? `Circulated ${circulated}. ${facts.ballotsReturned} of ${facts.electorate} institutions have voted.`
        : `Tells every eligible institution that voting is open.`,
      action:
        facts.status === "balloting" && !circulated
          ? { key: "circulateBallots", label: "Tell members voting is open", blockedBy: null }
          : facts.status === "balloting"
            ? { key: "circulateBallots", label: "Remind those who have not voted", blockedBy: null }
            : null,
    });

    stages.push({
      key: "ballots_close",
      label: "Voting closes",
      on: s.ballotsCloseAt,
      windowLabel: null,
      state: facts.sealed
        ? "done"
        : today >= s.ballotsCloseAt
          ? "current"
          : "upcoming",
      detail: facts.sealed
        ? "Sealed. The link between institution and selection is gone."
        : "Sealing strips the link between institution and selection. It cannot be undone.",
      action: facts.sealed
        ? null
        : {
            key: "sealElection",
            label: "Seal the ballots",
            blockedBy:
              today < s.ballotsCloseAt ? `Voting is open until ${s.ballotsCloseAt}.` : null,
          },
    });

    stages.push({
      key: "certify",
      label: "Count and certify",
      on: null,
      windowLabel: null,
      state: facts.certifiedAt ? "done" : facts.sealed ? "current" : "blocked",
      detail: facts.certifiedAt
        ? `Certified ${day(facts.certifiedAt)}.`
        : facts.sealed
          ? "The scrutineer's count, reconciled against the roll."
          : "Waiting for the ballots to be sealed.",
      action: facts.certifiedAt
        ? null
        : {
            key: "certifyElection",
            label: "Certify the result",
            blockedBy: facts.sealed ? null : "The ballots are not sealed yet.",
          },
    });
  }

  // 5 — Notice of meeting. A window, not a deadline.
  const noticeSent = day(facts.noticeSentAt);
  const w = facts.noticeWindow;
  stages.push({
    key: "agm_notice",
    label: "Notice of the meeting",
    on: null,
    windowLabel: w ? `${w.opensOn} to ${w.closesOn}` : null,
    state: noticeSent
      ? "done"
      : w && today > w.closesOn
        ? "overdue"
        : w && today >= w.opensOn
          ? "current"
          : "upcoming",
    detail: noticeSent
      ? `Given ${noticeSent}.`
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
              : null,
        },
  });

  // 6 — Proxy form, its own deadline.
  const proxySent = day(facts.proxySentAt);
  stages.push({
    key: "proxy_form",
    label: "Proxy form",
    on: w?.proxyDueOn ?? null,
    windowLabel: null,
    state: proxySent
      ? "done"
      : w && today > w.proxyDueOn
        ? "overdue"
        : "upcoming",
    detail: proxySent
      ? `Sent ${proxySent}.`
      : `By-Law Part VII S7(b) — members must have it 30 days before the meeting.`,
    action: proxySent ? null : { key: "sendProxyForm", label: "Send the proxy form", blockedBy: null },
  });

  // 7 — The members' package.
  const packageSent = day(facts.packageSentAt);
  // Only "current" once the meeting is actually being prepared. Marked current
  // year-round it becomes the headline in August, ahead of the call for
  // nominations that is the real next act — which is exactly backwards for a
  // screen whose job is to say what to do now.
  const packageSeason = w ? today >= w.opensOn : today >= s.ballotsCloseAt;
  stages.push({
    key: "agm_package",
    label: "Members' AGM package",
    on: null,
    windowLabel: null,
    state: packageSent ? "done" : packageSeason ? "current" : "upcoming",
    detail: packageSent
      ? `Sent ${packageSent}.`
      : "Agenda, minutes, financial statements, the committee's report and the candidates.",
    action: packageSent
      ? { key: "sendAgmPackage", label: "Send it again", blockedBy: null }
      : { key: "sendAgmPackage", label: "Send the package", blockedBy: null },
  });

  // 8 — The meeting.
  stages.push({
    key: "agm",
    label: `${facts.cycleYear} Annual General Meeting`,
    on: s.agmDate,
    windowLabel: null,
    state: today > s.agmDate ? "done" : today === s.agmDate ? "current" : "upcoming",
    detail:
      today > s.agmDate
        ? "The meeting has taken place."
        : "The members elect the board at this meeting.",
    action: null,
  });

  // 9 — Announcing. Only after the meeting, because the meeting is what elects.
  const announced = day(facts.resultsAnnouncedAt);
  stages.push({
    key: "announce_result",
    label: "Announce the result",
    on: null,
    windowLabel: null,
    state: announced ? "done" : today >= s.agmDate ? "current" : "blocked",
    detail: announced
      ? `Announced ${announced}.`
      : today >= s.agmDate
        ? "Tell the membership who the members elected."
        : "The members elect at the meeting, so there is nothing to announce until it has happened.",
    action: announced
      ? null
      : {
          key: "announceResults",
          label: "Announce the result",
          blockedBy: !facts.certifiedAt
            ? "The result is not certified."
            : today < s.agmDate
              ? `Not until the meeting on ${s.agmDate}.`
              : null,
        },
  });

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
