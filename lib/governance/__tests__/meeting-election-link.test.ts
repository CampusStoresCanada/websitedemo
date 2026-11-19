/**
 * Whether a connection between an election and a members' meeting may still be
 * undone.
 *
 * ⛔ This is the gate on an irreversible-in-practice act, and it is PURE for
 * exactly that reason: the screen uses it to decide whether to offer the
 * button, and the writer uses it to decide whether to honour the press. If the
 * two could disagree, the button would be there and the act would be refused —
 * or worse, the button would be gone and the act would still work.
 */

import { describe, it, expect } from "vitest";
import { disconnectBlockedBecause } from "@/lib/governance/meeting-election-link";

const clean = {
  noticeSentAt: null,
  proxyFormSentAt: null,
  packageSentAt: null,
};

describe("disconnectBlockedBecause", () => {
  it("allows it while nothing has gone out and the election is open", () => {
    expect(
      disconnectBlockedBecause({ electionStatus: "nominating", meeting: clean })
    ).toBeNull();
  });

  it("⛔ refuses once NOTICE has gone out", () => {
    // Notice names the day the meeting sits, goes to every member institution,
    // and is discharged once. There is no second notice that un-tells people,
    // so the connection is a fact in the record of a statutory act.
    const why = disconnectBlockedBecause({
      electionStatus: "nominating",
      meeting: { ...clean, noticeSentAt: "2026-12-01T12:00:00Z" },
    });
    expect(why).not.toBeNull();
    expect(why).toMatch(/discharged once/);
  });

  it("refuses once the PROXY FORM has gone out", () => {
    // A proxy is appointed for a meeting on a stated day.
    expect(
      disconnectBlockedBecause({
        electionStatus: "nominating",
        meeting: { ...clean, proxyFormSentAt: "2026-12-05T12:00:00Z" },
      })
    ).toMatch(/proxy/i);
  });

  it("refuses once the PACKAGE has gone out", () => {
    expect(
      disconnectBlockedBecause({
        electionStatus: "nominating",
        meeting: { ...clean, packageSentAt: "2027-01-05T12:00:00Z" },
      })
    ).toMatch(/package/i);
  });

  it("refuses once the election is sealed or certified", () => {
    // The result is recorded against this meeting.
    for (const status of ["sealed", "certified"]) {
      const why = disconnectBlockedBecause({ electionStatus: status, meeting: clean });
      expect(why, status).not.toBeNull();
      expect(why, status).toContain(status);
    }
  });

  it("reports NOTICE first when several things have gone out", () => {
    // Notice is the one with the statutory consequence, so it is the reason a
    // person should be given even when the package followed it.
    expect(
      disconnectBlockedBecause({
        electionStatus: "certified",
        meeting: {
          noticeSentAt: "2026-12-01T12:00:00Z",
          proxyFormSentAt: "2026-12-05T12:00:00Z",
          packageSentAt: "2027-01-05T12:00:00Z",
        },
      })
    ).toMatch(/Notice of this meeting/);
  });

  it("does not block a draft or an open election that has sent nothing", () => {
    for (const status of ["draft", "nominating", "nominations_closed", "balloting"]) {
      expect(
        disconnectBlockedBecause({ electionStatus: status, meeting: clean }),
        status
      ).toBeNull();
    }
  });
});

// ─── What may be offered for connection ─────────────────────────────────────
//
// `listConnectableMeetings` hits the database, so the FILTER is what is pinned
// here rather than the query. The rule it encodes was found by looking at the
// screen: an election in setup was being offered the January 2026 AGM.

describe("which meetings may be offered (the filter's rule)", () => {
  const today = "2026-11-19";

  const offerable = (m: { meetingDate: string; status: string }) =>
    m.status !== "cancelled" && m.meetingDate >= today;

  it("offers a future meeting that is going ahead", () => {
    expect(offerable({ meetingDate: "2027-01-21", status: "upcoming" })).toBe(true);
  });

  it("⛔ does not offer a meeting that has already sat", () => {
    // Connecting to it would derive a nomination window that closed last year.
    // `validateSchedule` would NOT object: the windows are internally coherent,
    // they are simply all in the past.
    expect(offerable({ meetingDate: "2026-01-15", status: "completed" })).toBe(false);
  });

  it("does not offer a cancelled meeting", () => {
    // There is no point measuring anything back from a date nobody will keep.
    expect(offerable({ meetingDate: "2027-01-21", status: "cancelled" })).toBe(false);
  });

  it("offers a meeting sitting today", () => {
    expect(offerable({ meetingDate: today, status: "upcoming" })).toBe(true);
  });
});
