import { describe, it, expect } from "vitest";
import { buildElectionTimeline, currentStage, type TimelineFacts } from "../timeline";

/**
 * The timeline exists so somebody who runs this once a year can see where they
 * are without knowing the process. These tests pin the two things that makes
 * true: the order never depends on when a control was built, and a stage that
 * cannot run says what is stopping it.
 */

function facts(over: Partial<TimelineFacts> = {}): TimelineFacts {
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
    noticeSentAt: null,
    proxySentAt: null,
    packageSentAt: null,
    resultsAnnouncedAt: null,
    certifiedAt: null,
    sealed: false,
    noticeWindow: { opensOn: "2026-12-17", closesOn: "2026-12-31", proxyDueOn: "2026-12-22" },
    eventPublished: true,
    nominationsReceived: 5,
    validatedNominees: 3,
    ballotsReturned: 0,
    electorate: 52,
    ...over,
  };
}

describe("buildElectionTimeline — the spine", () => {
  it("runs in the order things happen, not the order they were built", () => {
    const t = buildElectionTimeline(facts(), "2026-10-01");
    expect(t.map((s) => s.key)).toEqual([
      "cycle_open",
      "call_for_nominations",
      "close_nominations",
      "circulate_ballots",
      "ballots_close",
      "certify",
      "agm_notice",
      "proxy_form",
      "agm_package",
      "agm",
      "announce_result",
    ]);
  });

  it("drops the whole ballot when the slate is acclaimed", () => {
    const t = buildElectionTimeline(
      facts({ outcome: "acclaimed", status: "nominations_closed" }),
      "2026-11-01"
    );
    const ballot = t.find((s) => s.key === "ballot");
    expect(ballot?.state).toBe("not_applicable");
    expect(t.map((s) => s.key)).not.toContain("circulate_ballots");
    expect(t.map((s) => s.key)).not.toContain("certify");
  });
});

describe("buildElectionTimeline — what is stopping each stage", () => {
  it("will not close nominations before the published date", () => {
    const t = buildElectionTimeline(facts(), "2026-10-01");
    const close = t.find((s) => s.key === "close_nominations")!;
    expect(close.action?.blockedBy).toMatch(/Not until 2026-10-23/);
  });

  it("blocks notice on an unpublished event page", () => {
    const t = buildElectionTimeline(facts({ eventPublished: false }), "2026-12-18");
    const notice = t.find((s) => s.key === "agm_notice")!;
    expect(notice.action?.blockedBy).toMatch(/Publish the meeting's event page/);
  });

  it("blocks notice before the window opens, and names the date", () => {
    const t = buildElectionTimeline(facts(), "2026-12-01");
    const notice = t.find((s) => s.key === "agm_notice")!;
    expect(notice.action?.blockedBy).toMatch(/window opens 2026-12-17/);
  });

  it("marks notice overdue once the window has closed", () => {
    const t = buildElectionTimeline(facts(), "2027-01-05");
    expect(t.find((s) => s.key === "agm_notice")!.state).toBe("overdue");
  });

  it("will not announce before the meeting, because the meeting elects", () => {
    const t = buildElectionTimeline(
      facts({ status: "certified", certifiedAt: "2026-12-10T00:00:00Z", sealed: true }),
      "2026-12-20"
    );
    const announce = t.find((s) => s.key === "announce_result")!;
    expect(announce.state).toBe("blocked");
    expect(announce.action?.blockedBy).toMatch(/Not until the meeting on 2027-01-21/);
  });

  it("will not certify before sealing", () => {
    const t = buildElectionTimeline(facts({ status: "balloting" }), "2026-12-08");
    const certify = t.find((s) => s.key === "certify")!;
    expect(certify.state).toBe("blocked");
    expect(certify.action?.blockedBy).toMatch(/not sealed/);
  });
});

describe("buildElectionTimeline — the overdue call", () => {
  it("flags a call that should have gone out and has not", () => {
    // The failure that would have silently broken the 2027 cycle: nominations
    // "open" by the calendar while the form still turns members away.
    const t = buildElectionTimeline(facts({ callSentAt: null, status: "draft" }), "2026-10-01");
    const call = t.find((s) => s.key === "call_for_nominations")!;
    expect(call.state).toBe("overdue");
    expect(call.detail).toMatch(/turns members away/);
  });
});

describe("currentStage", () => {
  it("puts anything overdue first", () => {
    const t = buildElectionTimeline(facts({ callSentAt: null, status: "draft" }), "2026-10-01");
    expect(currentStage(t)?.key).toBe("call_for_nominations");
  });

  it("otherwise picks the stage that can actually be acted on", () => {
    const t = buildElectionTimeline(facts(), "2026-10-25");
    const stage = currentStage(t)!;
    expect(stage.action?.blockedBy ?? null).toBeNull();
  });
});

describe("currentStage — the headline must be the real next act", () => {
  it("does not make the AGM package the headline in September", () => {
    // Found by reading real output: the package was "current" year-round, so it
    // outranked the call for nominations as the thing to do next.
    const t = buildElectionTimeline(facts({ callSentAt: null, status: "draft" }), "2026-09-01");
    expect(t.find((s) => s.key === "agm_package")!.state).toBe("upcoming");
    // Nothing is due on 1 September, so the headline is the next thing up —
    // not the package, which used to claim "current" all year.
    expect(currentStage(t)?.key).toBe("call_for_nominations");
  });

  it("becomes current once the notice window opens", () => {
    const t = buildElectionTimeline(facts(), "2026-12-18");
    expect(t.find((s) => s.key === "agm_package")!.state).toBe("current");
  });
});
