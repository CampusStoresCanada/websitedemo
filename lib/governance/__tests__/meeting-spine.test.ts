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
  it("runs in the order things happen, not the order they were built", () => {
    const t = buildMeetingSpine(facts(), "2026-10-01");
    expect(t.map((s) => s.key)).toEqual([
      "cycle_open",
      "call_for_nominations",
      "close_nominations",
      "circulate_ballots",
      "ballots_close",
      "certify",
      // The event page before notice: notice links to it.
      "event_published",
      "agm_notice",
      "proxy_form",
      // The agenda before the package: the agenda goes inside it.
      "agenda",
      "agm_package",
      "agm",
      // The candidates hear before the membership does.
      "tell_candidates",
      "announce_result",
    ]);
  });

  it("drops the whole ballot when the slate is acclaimed", () => {
    const t = buildMeetingSpine(
      facts({ election: election({ outcome: "acclaimed", status: "nominations_closed" }) }),
      "2026-11-01"
    );
    const ballot = t.find((s) => s.key === "ballot");
    expect(ballot?.state).toBe("not_applicable");
    expect(t.map((s) => s.key)).not.toContain("circulate_ballots");
    expect(t.map((s) => s.key)).not.toContain("certify");
  });
});

describe("buildMeetingSpine — what is stopping each stage", () => {
  it("will not close nominations before the published date", () => {
    const t = buildMeetingSpine(facts(), "2026-10-01");
    const close = t.find((s) => s.key === "close_nominations")!;
    expect(close.action?.blockedBy).toMatch(/Not until 2026-10-23/);
  });

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

  it("will not certify before sealing", () => {
    const t = buildMeetingSpine(facts({ election: election({ status: "balloting" }) }), "2026-12-08");
    const certify = t.find((s) => s.key === "certify")!;
    expect(certify.state).toBe("blocked");
    expect(certify.action?.blockedBy).toMatch(/not sealed/);
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
    const keys = t.map((s) => s.key);
    expect(keys.indexOf("event_published")).toBeLessThan(keys.indexOf("agm_notice"));
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
