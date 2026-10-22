import { describe, it, expect } from "vitest";
import { isBenchmarkingSurveyFlag, isConferenceAskFlag } from "@/lib/circle/flag-routing";

/**
 * Who hears about a flag depends on what was flagged.
 *
 * ⛔ Everywhere else on the site a flag means "this page says something wrong
 * about you", so the store that owns the page is exactly who should hear it.
 * Inside the survey it is the reverse: the store is the one reporting, and
 * routing by organization_id would have mailed their complaint back to
 * themselves and told CSC nothing.
 */
describe("flag routing", () => {
  it("sends survey flags to the committee", () => {
    for (const url of [
      "/benchmarking/survey",
      "/benchmarking/survey?start=1&org=abc",
      "https://campusstores.ca/benchmarking/worksheet?org=abc",
      "/benchmarking/compare",
    ]) {
      expect(isBenchmarkingSurveyFlag(url)).toBe(true);
    }
  });

  it("leaves every other page routing to the store it is about", () => {
    for (const url of [
      "/org/mcmaster-university",
      "/partners",
      "/conference/2027/99",
      // The admin pages are CSC's own and route normally.
      "/benchmarking/admin/2026/submissions",
    ]) {
      expect(isBenchmarkingSurveyFlag(url)).toBe(false);
    }
  });

  it("sends a conference ask to CSC staff, not to the asker's own store", () => {
    expect(isConferenceAskFlag("/admin/conference/abc/war-room")).toBe(true);
    expect(isConferenceAskFlag("/admin/conference/abc/war-room?ask=person-1")).toBe(true);
    // Other conference admin pages are CSC's own pages and route normally.
    expect(isConferenceAskFlag("/admin/conference/abc/badges")).toBe(false);
    expect(isConferenceAskFlag("/admin/conference/abc/war-roomy")).toBe(false);
    expect(isConferenceAskFlag("/conference/2027/99")).toBe(false);
  });
});
