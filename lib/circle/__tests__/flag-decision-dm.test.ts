import { describe, it, expect } from "vitest";
import { buildFlagDecisionDm, buildFlagDm } from "../flag-message";

/**
 * The round trip a flag makes, in words.
 *
 * ⛔ Both halves failed in the field on 2026-11-06 and neither failure threw:
 * the opening DM linked to a list instead of a row, and the decision sent
 * nothing at all. Sean Bell had three notifications he could not act on and no
 * way to see that one of them had already been dealt with.
 */

describe("the link a survey flag notification carries", () => {
  const base = {
    priorityLabel: "🟡 Normal priority",
    who: "Jackie Nguyen",
    note: "I don't have access to a report in Bookware to give this number.",
    elementContent: "Total transactions\nAcross every till and the webstore",
    reviewLink: "https://x/benchmarking/survey?flag=abc",
  };

  it("names THIS report, not the queue", () => {
    const dm = buildFlagDm({
      ...base,
      survey: true,
      issueLink: "https://x/benchmarking/admin/issues?flag=abc",
    });

    // ⛔ The actual regression: three flags produced three identical links.
    expect(dm).toContain("/benchmarking/admin/issues?flag=abc");
  });

  it("still quotes what they wrote and what they were on", () => {
    const dm = buildFlagDm({
      ...base,
      survey: true,
      issueLink: "https://x/benchmarking/admin/issues?flag=abc",
    });
    expect(dm).toContain("Bookware");
    expect(dm).toContain("Total transactions");
  });
});

describe("what the room hears when a flag is decided", () => {
  const base = { who: "Jackie", actor: "Sean Bell", elementContent: "Total transactions" };

  it("tells the reporter it is sorted, and who sorted it", () => {
    const dm = buildFlagDecisionDm({ ...base, status: "resolved" })!;
    expect(dm).toContain("Jackie");
    expect(dm).toContain("Sean Bell");
    expect(dm).toContain("Total transactions");
  });

  it("invites a reply on every outcome, so a decision is never the end of it", () => {
    for (const status of ["resolved", "dismissed"] as const) {
      expect(buildFlagDecisionDm({ ...base, status })).toMatch(/reply here|say so here/i);
    }
  });

  it("reads as a person even when we do not know who decided", () => {
    const dm = buildFlagDecisionDm({ ...base, actor: null, status: "resolved" })!;
    expect(dm).not.toContain("null");
    // A double SPACE is the tell of a dropped name. \n\n is the paragraph break
    // and must not be matched here.
    expect(dm).not.toMatch(/ {2,}/);
    expect(dm).toContain("We marked it resolved");
  });

  /*
    ⛔ The resolution note is internal. The textarea that collects it says "The
    store does not see this", and the reporter is in this room — so a decision
    message that carried it would publish a note about somebody to that person.
    There is no parameter for it, and this is the test that keeps it that way.
  */
  it("has no way to leak the internal resolution note", () => {
    const dm = buildFlagDecisionDm({ ...base, status: "dismissed" })!;
    expect(dm).not.toMatch(/what we did/i);
  });

  it("carries no em dash, because the member reads it", () => {
    for (const status of ["acknowledged", "resolved", "dismissed"] as const) {
      expect(buildFlagDecisionDm({ ...base, status })).not.toContain("—");
    }
  });
});
