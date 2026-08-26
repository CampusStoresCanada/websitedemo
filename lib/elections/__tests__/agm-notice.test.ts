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

  it("treats every day past the last USABLE one as closing", () => {
    // Once campus stores have shut, a notice is still legally givable and still
    // reaches nobody — so the whole holiday tail warns, not just the last few
    // days before the legal deadline.
    expect(evaluateNoticeWindow(AGM, "2026-12-20").code).toBe("ok_but_closing");
    expect(evaluateNoticeWindow(AGM, "2026-12-27").code).toBe("ok_but_closing");
    // Dec 17 is BOTH the recommended day and the last usable one, so it warns
    // too — with one usable day in the window, "today or nobody reads it" is
    // exactly what someone needs told.
    const only = evaluateNoticeWindow(AGM, "2026-12-17");
    expect(only.code).toBe("ok_but_closing");
    expect(only.canSend).toBe(true);
    expect(only.message).toMatch(/reaches nobody/);
  });

  it("reads as an ordinary send when the window has room", () => {
    // A meeting a week earlier clears the shutdown, and the first of its eight
    // usable days carries no warning.
    const roomy = evaluateNoticeWindow("2027-01-14", "2026-12-10");
    expect(roomy.code).toBe("ok");
    expect(roomy.message).toMatch(/Aim for 2026-12-10/);
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


describe("the holiday blackout", () => {
  it("counts the window's USABLE days, not its legal length", () => {
    // The 2027 window is 15 days long and exactly ONE of them lands before
    // campus stores close. Reading the window as "we have two weeks" is the
    // mistake this exists to prevent.
    const w = resolveNoticeWindow(AGM);
    expect(w.blackout).toEqual({ from: "2026-12-18", to: "2027-01-04" });
    expect(w.usableDays).toEqual(["2026-12-17"]);
    expect(w.recommendedOn).toBe("2026-12-17");
  });

  it("recommends the opening edge, never the deadline", () => {
    const w = resolveNoticeWindow(AGM);
    expect(w.recommendedOn).toBe(w.opensOn);
    expect(w.recommendedOn).not.toBe(w.closesOn);
  });

  it("says plainly that a notice sent into the blackout will not be read", () => {
    const v = evaluateNoticeWindow(AGM, "2026-12-23");
    expect(v.canSend).toBe(true); // legally given, and worth giving
    expect(v.message).toMatch(/given and not read/);
  });

  it("still counts a whole window as usable when it clears the holidays", () => {
    // An AGM a week earlier moves the window off the shutdown entirely.
    const w = resolveNoticeWindow("2027-01-14");
    expect(w.usableDays.length).toBe(8);
    expect(w.recommendedOn).toBe("2026-12-10");
  });

  it("has no blackout when the config carries none", () => {
    const w = resolveNoticeWindow(AGM, { ...CSC_NOTICE_CONFIG, blackout: null });
    expect(w.blackout).toBeNull();
    expect(w.usableDays.length).toBe(15);
  });
});
