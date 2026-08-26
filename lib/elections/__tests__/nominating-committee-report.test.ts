import { describe, it, expect } from "vitest";
import {
  buildNominatingCommitteeReport,
  sortByLastName,
  type NominatingCommitteeReportInput,
} from "../documents/nominating-committee-report";

/**
 * Checked against the report CSC actually issued for the 2026 cycle, dated
 * 15 September 2025 — same slate, same counts, same shape. If the generated
 * wording drifts from what the association recognises as its own document,
 * these are the tests that should fail.
 */
const REAL_2026: NominatingCommitteeReportInput = {
  cycleYear: 2026,
  reportDate: "2025-09-15",
  boardMinSeats: 7,
  boardMaxSeats: 9,
  seatsAvailable: 5,
  nominationsCloseOn: "2025-10-31",
  nominationFormName: "2026 Board Nomination Form",
  continuing: [
    { name: "Shannon Blackadder", institution: "University of Calgary", region: "Western Region" },
    { name: "Jason Kack", institution: "McGill University", region: "Eastern Region" },
    { name: "Patricia Linden-Teasdale", institution: "St. Francis Xavier University", region: "Eastern Region" },
    { name: "Shawn Davies", institution: "Algonquin College", region: "Eastern Region" },
  ],
  completing: [
    { name: "Kevin Liu", institution: "University of New Brunswick, Saint John", region: "Eastern Region" },
    { name: "Kerry Martin", institution: "Wilfrid Laurier University", region: "Eastern Region" },
    { name: "Imelda May", institution: "Capilano University", region: "Western Region" },
    { name: "Sam Willis", institution: "Lakeland College", region: "Western Region" },
    { name: "Sean Bell", institution: "University of Lethbridge", region: "Western Region" },
  ],
  candidates: [
    { name: "Sean Bell", institution: "University of Lethbridge", region: "Western Region", isIncumbent: true },
    { name: "Kevin Liu", institution: "University of New Brunswick, Saint John", region: "Eastern Region", isIncumbent: true },
    { name: "Imelda May", institution: "Capilano University", region: "Western Region", isIncumbent: true },
    { name: "Sam Willis", institution: "Lakeland College", region: "Western Region", isIncumbent: true },
  ],
  officerTitles: ["President", "Vice President", "Secretary", "Treasurer"],
};

describe("against the real 2026 report", () => {
  const report = buildNominatingCommitteeReport(REAL_2026);
  const text = report.sections.flatMap((s) => s.paragraphs).join("\n");

  it("states the board range from the Articles, not the fixed number", () => {
    expect(text).toContain("minimum of 7 and a maximum of 9 Directors");
  });

  it("counts continuing and completing directors in words", () => {
    expect(text).toContain("During 2026-2027, the following Directors will serve the second year");
    expect(text).toContain("There are five Directors completing their terms this year");
  });

  it("presents four candidates for re-election, alphabetically by LAST name", () => {
    expect(text).toContain("The following four candidates (in alphabetical order by last name)");
    expect(text).toContain("stand for re-election");
    const roster = report.sections.find((s) => s.paragraphs[0]?.includes("candidates"))!.roster!;
    expect(roster.map((c) => c.name)).toEqual([
      "Sean Bell",
      "Kevin Liu",
      "Imelda May",
      "Sam Willis",
    ]);
  });

  it("names the vacancy — an under-subscribed slate is a real outcome, not an error", () => {
    // Five seats, four candidates. This is exactly what happened in 2026.
    expect(report.vacancies).toBe(1);
    expect(text).toContain("One vacant Director position remains open.");
  });

  it("carries the nomination deadline in long form", () => {
    expect(text).toContain("no later than October 31, 2025");
    expect(text).toContain("2026 Board Nomination Form");
  });

  it("lists the officers the board appoints", () => {
    expect(text).toContain("President · Vice President · Secretary · Treasurer");
  });

  it("renders HTML with the roster as a table and the sign-off", () => {
    expect(report.html).toContain("<h1>Nominating Committee Report</h1>");
    expect(report.html).toContain("University of New Brunswick, Saint John");
    expect(report.html).toContain("2026 Nominating Committee");
  });
});

describe("cases the 2026 report did not have to cover", () => {
  it("says election, not re-election, when a newcomer stands", () => {
    const r = buildNominatingCommitteeReport({
      ...REAL_2026,
      candidates: [
        ...REAL_2026.candidates,
        { name: "Karin Stonehouse", institution: "McMaster University", region: "Eastern Region", isIncumbent: false },
      ],
    });
    expect(r.sections.flatMap((s) => s.paragraphs).join("\n")).toContain("stand for election");
    expect(r.vacancies).toBe(0);
  });

  it("handles a slate with nobody on it", () => {
    const r = buildNominatingCommitteeReport({ ...REAL_2026, candidates: [] });
    const text = r.sections.flatMap((s) => s.paragraphs).join("\n");
    expect(text).toContain("No candidates have come forward");
    expect(text).toContain("Five vacant Director positions remain open.");
  });

  it("uses the singular throughout for a one-seat cycle", () => {
    const r = buildNominatingCommitteeReport({
      ...REAL_2026,
      seatsAvailable: 1,
      completing: [REAL_2026.completing[0]],
      candidates: [REAL_2026.candidates[0]],
    });
    const text = r.sections.flatMap((s) => s.paragraphs).join("\n");
    expect(text).toContain("There is one Director completing their term this year");
    expect(text).toContain("The following one candidate");
    expect(r.vacancies).toBe(0);
  });

  it("escapes names rather than trusting them into HTML", () => {
    const r = buildNominatingCommitteeReport({
      ...REAL_2026,
      candidates: [{ name: "A & B <script>", institution: "X", region: "Eastern Region", isIncumbent: false }],
    });
    expect(r.html).toContain("A &amp; B &lt;script&gt;");
    expect(r.html).not.toContain("<script>");
  });
});

describe("sortByLastName", () => {
  it("sorts on the last word, not the first", () => {
    expect(sortByLastName([{ name: "Sam Willis" }, { name: "Sean Bell" }]).map((p) => p.name)).toEqual([
      "Sean Bell",
      "Sam Willis",
    ]);
  });
});
