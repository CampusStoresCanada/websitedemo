import { describe, it, expect } from "vitest";
import { CAPABILITIES, opensBenchmarkingAdmin } from "../capability-names";

/**
 * A benchmarking invitation is a task, not committee membership.
 *
 * The regression this pins down: /benchmarking/admin was gated on "is a
 * reviewer", which resolved to content_review OR qa_verify. Someone invited to
 * check twelve question wordings therefore reached the submissions list for
 * every member store, and the flag queue where other stores' figures get
 * ruled on. Neither page had a check of its own.
 */
describe("opensBenchmarkingAdmin", () => {
  it("keeps question review out of the back office", () => {
    expect(
      opensBenchmarkingAdmin([CAPABILITIES.BENCHMARKING_CONTENT_REVIEW]),
    ).toBe(false);
  });

  it("lets interpretation in — the flag queue is its job", () => {
    expect(opensBenchmarkingAdmin([CAPABILITIES.BENCHMARKING_QA_VERIFY])).toBe(
      true,
    );
  });

  it("lets the committee lead in", () => {
    expect(
      opensBenchmarkingAdmin([CAPABILITIES.BENCHMARKING_COMMITTEE_LEAD]),
    ).toBe(true);
  });

  it("keeps recipient confirmation out — their work is their own region", () => {
    expect(
      opensBenchmarkingAdmin([CAPABILITIES.BENCHMARKING_RECIPIENT_CONFIRM]),
    ).toBe(false);
  });

  it("admits nobody holding none of it", () => {
    expect(opensBenchmarkingAdmin([])).toBe(false);
    expect(
      opensBenchmarkingAdmin([CAPABILITIES.ELECTIONS_NOMINATING_REVIEW]),
    ).toBe(false);
  });

  it("still admits someone who holds question review AND interpretation", () => {
    expect(
      opensBenchmarkingAdmin([
        CAPABILITIES.BENCHMARKING_CONTENT_REVIEW,
        CAPABILITIES.BENCHMARKING_QA_VERIFY,
      ]),
    ).toBe(true);
  });
});
