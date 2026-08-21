import { describe, it, expect } from "vitest";
import {
  resolveNoticeWindow,
  evaluateNoticeWindow,
  evaluateProxyDeadline,
  CSC_NOTICE_CONFIG,
} from "../agm-notice";

const AGM = "2027-01-21";

describe("the notice window", () => {
  it("is a window with a ceiling, not just a floor", () => {
    // "during a period of 21 to 35 days before" — too early is as defective as
    // too late, which is the part that reads like a floor and isn't.
    const w = resolveNoticeWindow(AGM);
    expect(w.opensOn).toBe("2026-12-17");
    expect(w.closesOn).toBe("2026-12-31");
    expect(w.proxyDueOn).toBe("2026-12-22");
  });

  it("finds the days on which one send discharges both obligations", () => {
    const w = resolveNoticeWindow(AGM);
    expect(w.combinedFrom).toBe("2026-12-17");
    expect(w.combinedTo).toBe("2026-12-22");
  });

  it("reports no combined window when the config makes them disjoint", () => {
    // A proxy deadline earlier than the notice window opens cannot be met by
    // the same send.
    const w = resolveNoticeWindow(AGM, {
      ...CSC_NOTICE_CONFIG,
      proxyFormDaysBefore: 60,
    });
    expect(w.combinedFrom).toBeNull();
  });
});

describe("evaluating a send date", () => {
  it("refuses before the window opens", () => {
    const v = evaluateNoticeWindow(AGM, "2026-12-01");
    expect(v.canSend).toBe(false);
    expect(v.code).toBe("too_early");
  });

  it("allows the first day", () => {
    expect(evaluateNoticeWindow(AGM, "2026-12-17").canSend).toBe(true);
  });

  it("allows the last day", () => {
    const v = evaluateNoticeWindow(AGM, "2026-12-31");
    expect(v.canSend).toBe(true);
    expect(v.code).toBe("ok_but_closing");
  });

  it("warns through the holiday tail", () => {
    // The last days of a January AGM's window fall over Christmas, with no
    // board meeting left to catch a miss.
    expect(evaluateNoticeWindow(AGM, "2026-12-27").code).toBe("ok_but_closing");
    expect(evaluateNoticeWindow(AGM, "2026-12-20").code).toBe("ok");
  });

  it("refuses after the window, and says what that means", () => {
    const v = evaluateNoticeWindow(AGM, "2027-01-02");
    expect(v.canSend).toBe(false);
    expect(v.code).toBe("too_late");
    expect(v.message).toMatch(/improperly called/);
    expect(v.message).toMatch(/could be challenged/);
  });

  it("counts the days left honestly", () => {
    expect(evaluateNoticeWindow(AGM, "2026-12-24").daysLeftInWindow).toBe(7);
    expect(evaluateNoticeWindow(AGM, "2026-12-17").daysUntilAgm).toBe(35);
  });
});

describe("the proxy form", () => {
  it("is due 30 days before", () => {
    expect(evaluateProxyDeadline(AGM, "2026-12-01").dueOn).toBe("2026-12-22");
  });

  it("is still worth sending late — unlike notice of the meeting", () => {
    // A late proxy form leaves a member worse off; it does not invalidate the
    // meeting. Refusing to send it would help nobody.
    const v = evaluateProxyDeadline(AGM, "2027-01-05");
    expect(v.overdue).toBe(true);
    expect(v.canSend).toBe(true);
    expect(v.message).toMatch(/Send it anyway/);
  });
});
