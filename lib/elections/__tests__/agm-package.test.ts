import { describe, it, expect } from "vitest";
import { buildAgmPackage, type AgmPackageInput } from "../documents/agm-package";

/**
 * The package exists to say what is MISSING. Most items generate themselves;
 * the meeting is held up by the handful a person has to produce, and the
 * financial review is the one nothing in this system can conjure.
 */

function input(over: Partial<AgmPackageInput> = {}): AgmPackageInput {
  return {
    cycleYear: 2027,
    agmDate: "2027-01-21",
    fiscalYearEnd: "2026-06-30",
    publicAccountant: "MNP LLP",
    noticeSentAt: "2026-12-17",
    hasAgenda: true,
    priorAgmDate: "2026-01-22",
    hasPriorMinutes: true,
    financialStatementsFilename: "CSC-2026-reviewed-statements.pdf",
    nominationsClosed: true,
    candidateCount: 6,
    outcome: "balloted",
    proxyFormSentAt: "2026-12-17",
    ...over,
  };
}

describe("buildAgmPackage — a complete package", () => {
  const pkg = buildAgmPackage(input());

  it("reports complete with nothing outstanding", () => {
    expect(pkg.complete).toBe(true);
    expect(pkg.outstanding).toEqual([]);
    expect(pkg.summary).toMatch(/complete and can go to members/);
  });

  it("carries every item the by-laws and the script assume", () => {
    const keys = pkg.items.map((i) => i.key);
    expect(keys).toEqual([
      "notice",
      "agenda",
      "prior_minutes",
      "financials",
      "nominating_report",
      "candidate_statements",
      "proxy_form",
    ]);
  });

  it("says WHY each item is in the package, not just that it is", () => {
    for (const item of pkg.items) {
      expect(item.because.length).toBeGreaterThan(20);
    }
  });
});

describe("buildAgmPackage — the financial review", () => {
  it("is the item nothing here can generate", () => {
    const pkg = buildAgmPackage(input({ financialStatementsFilename: null }));
    const fin = pkg.items.find((i) => i.key === "financials")!;
    expect(fin.state).toBe("missing");
    expect(fin.waitingOn).toContain("MNP LLP");
    expect(pkg.complete).toBe(false);
  });

  it("names the file once it is uploaded", () => {
    const pkg = buildAgmPackage(input());
    const fin = pkg.items.find((i) => i.key === "financials")!;
    expect(fin.state).toBe("supplied");
    expect(fin.source).toBe("CSC-2026-reviewed-statements.pdf");
  });

  it("names the fiscal year the statements cover, not the AGM year", () => {
    // The 2027 AGM receives the statements for the year ended June 2026.
    const pkg = buildAgmPackage(input());
    const fin = pkg.items.find((i) => i.key === "financials")!;
    expect(fin.title).toContain("June 30, 2026");
  });
});

describe("buildAgmPackage — items that depend on the election", () => {
  it("waits for nominations to close before the committee report", () => {
    const pkg = buildAgmPackage(input({ nominationsClosed: false }));
    const report = pkg.items.find((i) => i.key === "nominating_report")!;
    expect(report.state).toBe("missing");
    // Lower-cased because it renders inside "Waiting on ___."
    expect(report.waitingOn).toMatch(/nominations to close/);
  });

  it("drops candidate statements when the slate is acclaimed", () => {
    // No ballot means no decision for a statement to inform. Asking members to
    // read them would imply a choice they are not being offered.
    const pkg = buildAgmPackage(input({ outcome: "acclaimed", candidateCount: 4 }));
    const bios = pkg.items.find((i) => i.key === "candidate_statements")!;
    expect(bios.state).toBe("not_applicable");
    expect(pkg.complete).toBe(true);
  });

  it("does not count a not-applicable item as outstanding", () => {
    const pkg = buildAgmPackage({ ...input(), priorAgmDate: null, hasPriorMinutes: false });
    const minutes = pkg.items.find((i) => i.key === "prior_minutes")!;
    expect(minutes.state).toBe("not_applicable");
    expect(pkg.complete).toBe(true);
  });
});

describe("buildAgmPackage — what it tells the person holding it", () => {
  it("lists everything outstanding in one sentence", () => {
    const pkg = buildAgmPackage(
      input({ financialStatementsFilename: null, hasAgenda: false, proxyFormSentAt: null })
    );
    expect(pkg.outstanding).toHaveLength(3);
    expect(pkg.summary).toMatch(/3 items outstanding/);
    // Titles are listed as written — lower-casing them mangled "August 31".
    expect(pkg.summary).toMatch(/Agenda/);
    expect(pkg.summary).toMatch(/Proxy form/);
    expect(pkg.summary).not.toMatch(/august/);
  });

  it("names someone for every outstanding item", () => {
    const pkg = buildAgmPackage(
      input({
        noticeSentAt: null,
        hasAgenda: false,
        hasPriorMinutes: false,
        financialStatementsFilename: null,
        nominationsClosed: false,
        candidateCount: 0,
        proxyFormSentAt: null,
      })
    );
    expect(pkg.outstanding.length).toBeGreaterThan(0);
    for (const item of pkg.outstanding) {
      expect(item.waitingOn).toBeTruthy();
    }
  });
});
