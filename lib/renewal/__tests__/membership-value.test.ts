import { describe, it, expect } from "vitest";
import { buildMembershipValueHtml, type MembershipValueInput } from "../membership-value";

const ELECTION = {
  cycleYear: 2027,
  nominationsOpenOn: "2026-09-23",
  nominationsCloseOn: "2026-10-23",
  agmDate: "2027-01-21",
  seatsAvailable: 4,
};

const base: MembershipValueInput = {
  stage: "reminder",
  lapsesOn: "2026-10-01",
  election: ELECTION,
  appUrl: "https://example.org",
};

describe("what the clause says", () => {
  it("uses the association's own approved pillars, verbatim", () => {
    // Lifted from the 2025-11-05 campaign. If these drift, the renewal series
    // stops sounding like CSC and starts sounding like software.
    const html = buildMembershipValueHtml(base);
    for (const pillar of [
      "A community that gets it",
      "Data that proves your value",
      "Ongoing education",
      "Collective advocacy",
    ]) {
      expect(html).toContain(pillar);
    }
    expect(html).toContain("budgets are under pressure across the sector");
  });

  it("does NOT promise the salary survey — participation is unconfirmed", () => {
    expect(buildMembershipValueHtml(base).toLowerCase()).not.toContain("salary");
  });

  it("treats Circle and Member Space as one thing, because they are", () => {
    const html = buildMembershipValueHtml(base);
    expect(html).toContain("Your peers are in Circle");
    expect(html).not.toContain("Member Space");
  });

  it("describes the platform as more than the community", () => {
    const html = buildMembershipValueHtml(base);
    expect(html).toContain("The member platform");
    expect(html).toContain("partner directory");
    expect(html).toContain('href="https://example.org"');
  });

  it("decouples membership from the conference", () => {
    expect(buildMembershipValueHtml(base)).toContain(
      "whether you make it to the show or not"
    );
  });
});

describe("the election line", () => {
  it("names the dates and what lapsing costs", () => {
    const html = buildMembershipValueHtml(base);
    expect(html).toContain("September 23, 2026 to October 23, 2026");
    expect(html).toContain("4 seats");
    expect(html).toContain("cannot second a colleague's nomination");
  });

  it("is ABSENT when no cycle is open — it must not invent one", () => {
    const html = buildMembershipValueHtml({ ...base, election: null });
    expect(html).not.toContain("board election");
    expect(html).not.toContain("Nominations are open");
    expect(html).toContain("Data that proves your value");
  });

  it("changes tense once access is suspended", () => {
    const html = buildMembershipValueHtml({ ...base, stage: "locked" });
    expect(html).toContain("A suspended membership cannot nominate");
    expect(html).toContain("Reactivating restores");
    expect(html).not.toContain("Nominations are open");
  });

  it("uses the singular for a one-seat cycle", () => {
    const html = buildMembershipValueHtml({
      ...base,
      election: { ...ELECTION, seatsAvailable: 1 },
    });
    expect(html).toContain("1 seat,");
    expect(html).not.toContain("1 seats");
  });
});

describe("the series escalates", () => {
  it("is forward-looking before expiry", () => {
    expect(buildMembershipValueHtml(base)).toContain("What your membership carries");
  });

  it("names the date access lapses during grace", () => {
    const html = buildMembershipValueHtml({ ...base, stage: "grace" });
    expect(html).toContain("What lapses on <strong>October 1, 2026</strong>");
    expect(html).toContain("we would far rather sort it out than switch anything off");
  });

  it("copes with grace when no lapse date is known", () => {
    const html = buildMembershipValueHtml({ ...base, stage: "grace", lapsesOn: null });
    expect(html).toContain("What lapses<");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("reassures that nothing is deleted once locked", () => {
    const html = buildMembershipValueHtml({ ...base, stage: "locked" });
    expect(html).toContain("What has stopped");
    expect(html).toContain("Nothing has been deleted");
  });
});
