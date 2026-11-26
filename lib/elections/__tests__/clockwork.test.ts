/**
 * What the clock does, and — more importantly — what it refuses to do.
 *
 * `dueStep` is pure so this decision can be pinned without a database. It is
 * the whole judgement: everything else in the module is calling the same gated
 * service function the button used to call, and recording the result.
 */

import { describe, it, expect } from "vitest";
import { dueStep, type ClockworkElection } from "@/lib/elections/clockwork";

const base: ClockworkElection = {
  id: "e1",
  slug: "board-2027",
  status: "nominating",
  outcome: null,
  nominationsCloseAt: "2026-10-23",
  ballotsCloseAt: "2026-12-07",
  meetingId: "m1",
  meetingDate: "2027-01-21",
  candidateResultsSentAt: null,
};
const e = (over: Partial<ClockworkElection> = {}): ClockworkElection => ({ ...base, ...over });

describe("dueStep — closing nominations", () => {
  it("does nothing before the published date", () => {
    // MOVED here from the spine's "will not close nominations before the
    // published date". The window was printed in the call for nominations, so
    // the date is not anybody's to bring forward.
    expect(dueStep(e(), "2026-10-22")).toBeNull();
  });

  it("closes them ON the published date", () => {
    expect(dueStep(e(), "2026-10-23")).toBe("close_nominations");
  });

  it("closes them if the run was missed and the date has passed", () => {
    expect(dueStep(e(), "2026-11-04")).toBe("close_nominations");
  });
});

describe("dueStep — certification", () => {
  it("certifies an acclaimed slate as soon as nominations are closed", () => {
    // Nominees <= seats is arithmetic. Nothing is being decided.
    expect(
      dueStep(e({ status: "nominations_closed", outcome: "acclaimed" }), "2026-10-23")
    ).toBe("certify");
  });

  it("⛔ will NOT certify before sealing", () => {
    // MOVED here from the spine's "will not certify before sealing".
    expect(dueStep(e({ status: "balloting" }), "2026-12-06")).toBeNull();
  });

  it("seals on the ballot close date, and certifies once sealed", () => {
    expect(dueStep(e({ status: "balloting" }), "2026-12-07")).toBe("seal_ballots");
    expect(dueStep(e({ status: "sealed" }), "2026-12-08")).toBe("certify");
  });

  it("does not certify a balloted slate that is merely nominations_closed", () => {
    // Only an ACCLAIMED slate is final at that point; a balloted one has a
    // ballot still to run.
    expect(
      dueStep(e({ status: "nominations_closed", outcome: "balloted" }), "2026-11-01")
    ).toBeNull();
  });
});

describe("dueStep — where the clock stops", () => {
  it("⛔ does NOT surface telling the candidates before the MEETING", () => {
    // `buildMeetingSpine` blocks that press until the meeting has happened —
    // the members elect AT the meeting. An alert raised in November for a
    // January meeting is an obligation nobody is permitted to discharge, and it
    // would sit open for eight weeks.
    expect(dueStep(e({ status: "certified" }), "2026-12-20")).toBeNull();
    expect(dueStep(e({ status: "certified" }), "2027-01-20")).toBeNull();
  });

  it("⛔ stops at telling the candidates once the meeting HAS happened", () => {
    // The clock surfaces it; a person sends it. An unattended send that fails
    // at 2am is a notice nobody knows is missing.
    expect(dueStep(e({ status: "certified" }), "2027-01-21")).toBe("tell_candidates");
  });

  it("surfaces nothing when no meeting date is known", () => {
    expect(dueStep(e({ status: "certified", meetingDate: null }), "2030-01-01")).toBeNull();
  });

  it("has nothing left once the candidates have been told", () => {
    expect(
      dueStep(
        e({ status: "certified", candidateResultsSentAt: "2027-01-21T12:00:00Z" }),
        "2027-01-22"
      )
    ).toBeNull();
  });

  it("⛔ ignores an election with NO members' meeting connected", () => {
    // It has no calendar at all — every date is the meeting date minus N days —
    // so it cannot be past anything. It is in setup, not late.
    expect(dueStep(e({ meetingId: null }), "2027-06-01")).toBeNull();
    expect(
      dueStep(
        e({ meetingId: null, nominationsCloseAt: null, ballotsCloseAt: null }),
        "2027-06-01"
      )
    ).toBeNull();
  });

  it("does nothing for a draft that has not opened", () => {
    expect(dueStep(e({ status: "draft" }), "2026-11-01")).toBeNull();
  });

  it("is idempotent — a second run on the same day finds nothing to redo", () => {
    // Each step is gated on the CURRENT status, so once a step has advanced the
    // election the same input no longer matches it.
    const afterClose = e({ status: "nominations_closed", outcome: "balloted" });
    expect(dueStep(afterClose, "2026-10-23")).toBeNull();
  });
});
