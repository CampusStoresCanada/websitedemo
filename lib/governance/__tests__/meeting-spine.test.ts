import { describe, it, expect } from "vitest";
import { currentStage } from "@/lib/elections/timeline";
import {
  buildMeetingSpine,
  type ElectionFacts,
  type TimelineFacts,
} from "../meeting-spine";

/**
 * The timeline exists so somebody who runs this once a year can see where they
 * are without knowing the process. These tests pin the two things that makes
 * true: the order never depends on when a control was built, and a stage that
 * cannot run says what is stopping it.
 */

function election(over: Partial<ElectionFacts> = {}): ElectionFacts {
  return {
    cycleYear: 2027,
    status: "nominating",
    outcome: null,
    schedule: {
      agmDate: "2027-01-21",
      nominationsOpenAt: "2026-09-23",
      nominationsCloseAt: "2026-10-23",
      ballotsOpenAt: "2026-11-18",
      ballotsCloseAt: "2026-12-07",
    },
    callSentAt: "2026-09-23T10:00:00Z",
    ballotsCirculatedAt: null,
    resultsAnnouncedAt: null,
    candidateResultsSentAt: null,
    certifiedAt: null,
    sealed: false,
    nominationsReceived: 4,
    validatedNominees: 4,
    ballotsReturned: 0,
    electorate: 55,
    ...over,
  };
}

function facts(over: Partial<TimelineFacts> = {}): TimelineFacts {
  return {
    meetingLabel: "2027 Annual General Meeting",
    meetingDate: "2027-01-21",
    eventPublished: true,
    eventStartSet: true,
    eventGaps: [],
    agendaDrafted: false,
    noticeWindow: { opensOn: "2026-12-17", closesOn: "2026-12-31", proxyDueOn: "2026-12-22" },
    noticeSentAt: null,
    proxySentAt: null,
    packageSentAt: null,
    election: election(),
    ...over,
  };
}

describe("buildMeetingSpine — the spine", () => {
  it("carries ONLY what a human must do, in the order it has to happen", () => {
    // Steve 2026-11-26: "if someone needs to do an action, it goes into the
    // timeline. If there's nothing for a human to do, then it isn't on the
    // timeline."
    const t = buildMeetingSpine(facts(), "2026-10-01");
    expect(t.map((s) => s.key)).toEqual([
      // OUTSTANDING, in the order it has to happen. This is what the page opens
      // on, so the top of the list is the next thing somebody owes.
      "circulate_ballots",
      "agm_notice",
      "proxy_form",
      // The agenda before the package: the agenda goes inside it.
      "agenda",
      "agm_package",
      // The candidates hear before the membership does.
      "tell_candidates",
      "announce_result",
      // DONE, demoted. In this fixture the call has gone out and the event page
      // is published, so both move below the live work rather than sitting at
      // the top being already finished.
      "call_for_nominations",
      "event_published",
    ]);
  });

  it("⛔ leaves OFF the stages that were only status", () => {
    // "Cycle opened" is a fact, and the meeting is an event that happens to you.
    // Neither is a thing to do.
    const keys = buildMeetingSpine(facts(), "2026-10-01").map((s) => s.key);
    for (const k of ["cycle_open", "ballot", "agm"]) expect(keys, k).not.toContain(k);
  });

  it("⛔ leaves OFF the stages the CLOCK owns", () => {
    // Nothing on any of these was ever a choice: the nomination and ballot
    // windows were published to members before anyone knew the result, and an
    // acclamation is nominees <= seats. A press here is discretion over when a
    // legally deadlined act happens. See lib/elections/clockwork.ts.
    const keys = buildMeetingSpine(facts(), "2026-10-01").map((s) => s.key);
    for (const k of ["close_nominations", "ballots_close", "certify"])
      expect(keys, k).not.toContain(k);
  });

  it("⛔ an acclaimed slate still has no ballot step, and now no certify either", () => {
    // This used to be the defect rather than the design: `certify` was never
    // pushed for an acclamation, so the act that writes the directors' terms
    // appeared NOWHERE and was reachable only through a link named "Ballots &
    // audit" — in an election where no ballot was cast. It is absent now
    // because the clock does it, not because it was forgotten.
    const t = buildMeetingSpine(
      facts({ election: election({ outcome: "acclaimed", status: "nominations_closed" }) }),
      "2026-11-01"
    );
    const keys = t.map((s) => s.key);
    expect(keys).not.toContain("ballot");
    expect(keys).not.toContain("circulate_ballots");
    expect(keys).not.toContain("certify");
  });

  it("moves finished work BELOW what is still outstanding", () => {
    // Steve: "when a timeline action is completed it gets moved away from the
    // top of the page so that going to the timeline shows you what is next."
    const t = buildMeetingSpine(
      facts({ election: election({ callSentAt: "2026-09-23T12:00:00Z" }) }),
      "2026-10-01"
    );
    const keys = t.map((s) => s.key);
    const call = t.find((s) => s.key === "call_for_nominations")!;
    expect(call.state).toBe("done");
    // Done, so it sits after every outstanding stage rather than at the top.
    const lastOutstanding = Math.max(
      ...t.map((s, i) => (s.state === "done" || s.state === "not_applicable" ? -1 : i))
    );
    expect(keys.indexOf("call_for_nominations")).toBeGreaterThan(lastOutstanding);
  });
});

describe("buildMeetingSpine — what is stopping each stage", () => {
  // ⛔ "will not close nominations before the published date" and "will not
  // certify before sealing" MOVED to lib/elections/__tests__/clockwork.test.ts.
  // Both are now the clock's business, and both are tested there against
  // `dueStep`, which is the pure decision about what is due.

  it("blocks notice on an unpublished event page", () => {
    const t = buildMeetingSpine(facts({ eventPublished: false }), "2026-12-18");
    const notice = t.find((s) => s.key === "agm_notice")!;
    expect(notice.action?.blockedBy).toMatch(/Publish the meeting's event page/);
  });

  it("blocks notice before the window opens, and names the date", () => {
    const t = buildMeetingSpine(facts(), "2026-12-01");
    const notice = t.find((s) => s.key === "agm_notice")!;
    expect(notice.action?.blockedBy).toMatch(/window opens 2026-12-17/);
  });

  it("marks notice overdue once the window has closed", () => {
    const t = buildMeetingSpine(facts(), "2027-01-05");
    expect(t.find((s) => s.key === "agm_notice")!.state).toBe("overdue");
  });

  it("will not announce before the meeting, because the meeting elects", () => {
    const t = buildMeetingSpine(
      facts({
        election: election({
          status: "certified",
          certifiedAt: "2026-12-10T00:00:00Z",
          sealed: true,
        }),
      }),
      "2026-12-20"
    );
    const announce = t.find((s) => s.key === "announce_result")!;
    expect(announce.state).toBe("blocked");
    expect(announce.action?.blockedBy).toMatch(/Not until the meeting on 2027-01-21/);
  });

  it("⛔ tells an ACCLAIMED slate at once, while still not announcing", () => {
    // The pairing is the whole point of two stages: "each candidate hears
    // their own result before the membership does" is empty if both wait for
    // the same morning. Nominees <= seats was settled when nominations closed,
    // so there is nothing left for the members to decide about who is in —
    // only the Chair's announcement of it, which By-Law Part V S3(d) puts at
    // the meeting.
    const t = buildMeetingSpine(
      facts({
        election: election({
          status: "certified",
          outcome: "acclaimed",
          certifiedAt: "2026-11-26T16:15:00Z",
          sealed: false,
        }),
      }),
      "2026-11-26"
    );
    const tell = t.find((s) => s.key === "tell_candidates")!;
    expect(tell.state).toBe("current");
    expect(tell.action?.blockedBy).toBeNull();

    const announce = t.find((s) => s.key === "announce_result")!;
    expect(announce.state).toBe("blocked");
    expect(announce.action?.blockedBy).toMatch(/Not until the meeting on 2027-01-21/);
  });

  it("still will not tell a BALLOTED slate before the meeting", () => {
    // The members elect at the meeting, and a returned ballot is not a result
    // until the meeting receives it.
    const t = buildMeetingSpine(
      facts({
        election: election({
          status: "certified",
          outcome: "balloted",
          certifiedAt: "2026-12-10T00:00:00Z",
          sealed: true,
        }),
      }),
      "2026-12-20"
    );
    const tell = t.find((s) => s.key === "tell_candidates")!;
    expect(tell.state).toBe("blocked");
    expect(tell.action?.blockedBy).toMatch(/Not until the meeting on 2027-01-21/);
  });

  it("will not tell an acclaimed slate that is not certified", () => {
    // Lifting the meeting gate does not lift the certification one: the terms
    // are written BY certifying, so there is no result to tell before it.
    const t = buildMeetingSpine(
      facts({ election: election({ status: "nominations_closed", outcome: "acclaimed" }) }),
      "2026-11-26"
    );
    const tell = t.find((s) => s.key === "tell_candidates")!;
    expect(tell.state).toBe("blocked");
    expect(tell.action?.blockedBy).toMatch(/not certified/);
  });


});

describe("buildMeetingSpine — the overdue call", () => {
  it("flags a call that should have gone out and has not", () => {
    // The failure that would have silently broken the 2027 cycle: nominations
    // "open" by the calendar while the form still turns members away.
    const t = buildMeetingSpine(facts({ election: election({ callSentAt: null, status: "draft" }) }), "2026-10-01");
    const call = t.find((s) => s.key === "call_for_nominations")!;
    expect(call.state).toBe("overdue");
    expect(call.detail).toMatch(/turns members away/);
  });
});

describe("currentStage", () => {
  it("puts anything overdue first", () => {
    const t = buildMeetingSpine(facts({ election: election({ callSentAt: null, status: "draft" }) }), "2026-10-01");
    expect(currentStage(t)?.key).toBe("call_for_nominations");
  });

  it("otherwise picks the stage that can actually be acted on", () => {
    const t = buildMeetingSpine(facts(), "2026-10-25");
    const stage = currentStage(t)!;
    expect(stage.action?.blockedBy ?? null).toBeNull();
  });
});

describe("currentStage — the headline must be the real next act", () => {
  it("does not make the AGM package the headline in September", () => {
    // Found by reading real output: the package was "current" year-round, so it
    // outranked the call for nominations as the thing to do next.
    const t = buildMeetingSpine(facts({ election: election({ callSentAt: null, status: "draft" }) }), "2026-09-01");
    expect(t.find((s) => s.key === "agm_package")!.state).toBe("upcoming");
    // Nothing is due on 1 September, so the headline is the next thing up —
    // not the package, which used to claim "current" all year.
    expect(currentStage(t)?.key).toBe("call_for_nominations");
  });

  it("becomes current once the notice window opens", () => {
    const t = buildMeetingSpine(facts(), "2026-12-18");
    expect(t.find((s) => s.key === "agm_package")!.state).toBe("current");
  });
});

// ─── The meeting's own stages, on the same spine ────────────────────────────
//
// These are the point of the spine, not an addition to it: the meeting and the
// election are one activity, so publishing the page and drafting the agenda sit
// in the same ordered list as nominations and ballots.

describe("the meeting's stages", () => {
  it("puts the event page before notice, because notice links to it", () => {
    const t = buildMeetingSpine(facts(), "2026-12-20");
    // Among what is still OUTSTANDING: finished work is demoted below, so a
    // completed event page legitimately sorts after an outstanding notice.
    const outstanding = t
      .filter((x) => x.state !== "done" && x.state !== "not_applicable")
      .map((x) => x.key);
    expect(outstanding.indexOf("event_published")).toBeLessThan(
      outstanding.indexOf("agm_notice")
    );
  });

  it("carries what is missing from the event page as its detail", () => {
    const t = buildMeetingSpine(
      facts({ eventPublished: false, eventGaps: ["The start time is not set."] }),
      "2026-12-20"
    );
    const stage = t.find((s) => s.key === "event_published");
    expect(stage?.detail).toContain("The start time is not set.");
  });

  it("blocks publishing until the meeting has a start time, and says why", () => {
    const t = buildMeetingSpine(
      facts({ eventPublished: false, eventStartSet: false }),
      "2026-12-20"
    );
    const stage = t.find((s) => s.key === "event_published");
    expect(stage?.action?.key).toBe("publishEvent");
    expect(stage?.action?.blockedBy).toMatch(/time the meeting starts/i);
  });

  it("offers publishing once a start time is set", () => {
    const t = buildMeetingSpine(
      facts({ eventPublished: false, eventStartSet: true }),
      "2026-12-20"
    );
    expect(t.find((s) => s.key === "event_published")?.action?.blockedBy).toBeNull();
  });

  it("is done, with no action, once the page is published", () => {
    const t = buildMeetingSpine(facts({ eventPublished: true }), "2026-12-20");
    const stage = t.find((s) => s.key === "event_published");
    expect(stage?.state).toBe("done");
    expect(stage?.action).toBeNull();
  });

  it("goes overdue once the notice window has opened with no page", () => {
    // The notice window in `facts` opens 2026-12-17.
    const t = buildMeetingSpine(facts({ eventPublished: false }), "2026-12-20");
    expect(t.find((s) => s.key === "event_published")?.state).toBe("overdue");
  });

  it("puts the agenda before the package, because the agenda goes inside it", () => {
    const t = buildMeetingSpine(facts(), "2026-12-20");
    const keys = t.map((s) => s.key);
    expect(keys.indexOf("agenda")).toBeLessThan(keys.indexOf("agm_package"));
  });

  it("offers to generate the agenda while the meeting is being prepared", () => {
    const t = buildMeetingSpine(facts({ agendaDrafted: false }), "2026-12-20");
    const stage = t.find((s) => s.key === "agenda");
    expect(stage?.state).toBe("current");
    expect(stage?.action?.key).toBe("generateAgenda");
  });

  it("stops offering it once one is drafted", () => {
    const t = buildMeetingSpine(facts({ agendaDrafted: true }), "2026-12-20");
    const stage = t.find((s) => s.key === "agenda");
    expect(stage?.state).toBe("done");
    expect(stage?.action).toBeNull();
  });

  it("does not make the agenda the headline in August", () => {
    // Year-round "current" would push it ahead of the call for nominations,
    // which is the real next act in the summer.
    const t = buildMeetingSpine(facts({ agendaDrafted: false }), "2026-08-15");
    expect(t.find((s) => s.key === "agenda")?.state).toBe("upcoming");
  });
});

describe("notice recorded outside its window", () => {
  // The election's sender refuses outside the window, so this could only ever
  // read "Given". Notice recorded BY HAND for a members' meeting with no
  // election can carry any past date, and presenting that as discharged would
  // hide defective notice.
  it("says so when notice was given too early", () => {
    const t = buildMeetingSpine(
      facts({ noticeSentAt: "2026-11-01T00:00:00Z" }), // window opens 2026-12-17
      "2026-12-20"
    );
    expect(t.find((s) => s.key === "agm_notice")?.detail).toMatch(/OUTSIDE/);
  });

  it("says so when notice was given too late", () => {
    const t = buildMeetingSpine(
      facts({ noticeSentAt: "2027-01-10T00:00:00Z" }), // window closed 2026-12-31
      "2027-01-12"
    );
    expect(t.find((s) => s.key === "agm_notice")?.detail).toMatch(/OUTSIDE/);
  });

  it("reads plainly when it was given inside the window", () => {
    const t = buildMeetingSpine(
      facts({ noticeSentAt: "2026-12-20T00:00:00Z" }),
      "2026-12-22"
    );
    const d = t.find((s) => s.key === "agm_notice")?.detail;
    expect(d).toBe("Given 2026-12-20.");
    expect(d).not.toMatch(/OUTSIDE/);
  });
});
