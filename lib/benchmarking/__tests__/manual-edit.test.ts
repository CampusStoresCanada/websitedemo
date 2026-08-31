import { describe, it, expect } from "vitest";
import { decideBenchmarkingEdit } from "../manual-edit";

/**
 * The rule that decides whether a store may correct its own figures from the
 * org page. It is a policy, not plumbing — the survey owns these numbers while
 * a cycle is live, and an older year is somebody else's published report.
 */
describe("decideBenchmarkingEdit", () => {
  const latest = { isLatestYear: true, fiscalYear: 2025 };

  it("allows a correction between cycles, and marks it as one", () => {
    const decision = decideBenchmarkingEdit({ ...latest, surveyStatus: "complete" });

    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.manualAmendment).toBe(true);
    expect(decision.surveyStatus).toBe("complete");
  });

  it("stands down while the survey is open — the survey is the record", () => {
    const decision = decideBenchmarkingEdit({ ...latest, surveyStatus: "open" });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    // The store is told where to go, not merely refused.
    expect(decision.reason).toMatch(/survey/i);
  });

  it("stands down during a beta cycle too", () => {
    // Beta is live for a named few. For those stores the survey is open, so the
    // same rule has to hold or they get a second, unvalidated way in.
    expect(
      decideBenchmarkingEdit({ ...latest, surveyStatus: "beta" }).allowed,
    ).toBe(false);
  });

  it("allows it while next year's survey is still in draft", () => {
    // The ordinary state for most of the year: a cycle exists on the calendar
    // but has not opened. Nothing to defer to yet.
    expect(
      decideBenchmarkingEdit({ ...latest, surveyStatus: "draft" }).allowed,
    ).toBe(true);
  });

  it("allows it when no survey row exists for the year", () => {
    expect(
      decideBenchmarkingEdit({ ...latest, surveyStatus: null }).allowed,
    ).toBe(true);
  });

  it("refuses any year but the newest on file", () => {
    const decision = decideBenchmarkingEdit({
      isLatestYear: false,
      fiscalYear: 2023,
      surveyStatus: "complete",
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toContain("FY2023");
  });

  it("refuses an older year even when that year's survey is somehow open", () => {
    // Order matters: latest-year is checked first. A reopened prior cycle must
    // not become a back door to rewriting a year already reported on.
    expect(
      decideBenchmarkingEdit({
        isLatestYear: false,
        fiscalYear: 2024,
        surveyStatus: "open",
      }).allowed,
    ).toBe(false);
  });

  it("flags a published year as metrics-frozen", () => {
    // The source row still changes; computed_metrics deliberately does not.
    // The org page reads this to say so before anyone edits.
    const published = decideBenchmarkingEdit({ ...latest, surveyStatus: "complete" });
    expect(published.allowed && published.metricsFrozen).toBe(true);

    const notPublished = decideBenchmarkingEdit({ ...latest, surveyStatus: "draft" });
    expect(notPublished.allowed && notPublished.metricsFrozen).toBe(false);
  });
});
