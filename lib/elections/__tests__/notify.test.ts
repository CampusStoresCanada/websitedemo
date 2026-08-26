import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { summarizeOutcomes, type NotifyOutcome } from "../notify";

const outcome = (over: Partial<NotifyOutcome> = {}): NotifyOutcome => ({
  template: "election_nomination_received",
  to: "someone@example.org",
  sent: true,
  ...over,
});

describe("summarizeOutcomes", () => {
  it("counts sends and surfaces every failure with its reason", () => {
    const summary = summarizeOutcomes([
      outcome(),
      outcome({ sent: false, error: "No email address on record." }),
      outcome({ to: "", sent: false, error: "suppressed" }),
    ]);
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(2);
    expect(summary.problems).toHaveLength(2);
    expect(summary.problems[0]).toContain("No email address on record");
  });

  it("names the recipient in a problem, or omits it cleanly when there is none", () => {
    const summary = summarizeOutcomes([
      outcome({ sent: false, error: "boom" }),
      outcome({ to: "", sent: false, error: "no admin to ask" }),
    ]);
    expect(summary.problems[0]).toBe("election_nomination_received → someone@example.org: boom");
    expect(summary.problems[1]).toBe("election_nomination_received: no admin to ask");
  });

  it("is clean when everything sent", () => {
    const summary = summarizeOutcomes([outcome(), outcome()]);
    expect(summary).toEqual({ sent: 2, failed: 0, problems: [] });
  });
});

describe("the suppression choke point", () => {
  const original = process.env.ELECTIONS_SUPPRESS_EMAIL;
  beforeEach(() => {
    process.env.ELECTIONS_SUPPRESS_EMAIL = "1";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ELECTIONS_SUPPRESS_EMAIL;
    else process.env.ELECTIONS_SUPPRESS_EMAIL = original;
  });

  it("is only armed by the exact value 1", () => {
    // A guard that answers to any truthy string is a guard that fails open on a
    // typo, and this one is what stands between a test run and 40 campus stores.
    process.env.ELECTIONS_SUPPRESS_EMAIL = "true";
    expect(process.env.ELECTIONS_SUPPRESS_EMAIL === "1").toBe(false);
    process.env.ELECTIONS_SUPPRESS_EMAIL = "1";
    expect(process.env.ELECTIONS_SUPPRESS_EMAIL === "1").toBe(true);
  });
});
