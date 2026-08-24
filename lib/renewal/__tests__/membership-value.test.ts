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
  it("leads with the collective argument, not a feature list", () => {
    const html = buildMembershipValueHtml(base);
    expect(html).toContain("do the things no single store can do on its own");
    expect(html).toContain("A say in who runs the association");
    expect(html).toContain("does not exist anywhere else");
  });

  it("covers everything a member is paying for", () => {
    const html = buildMembershipValueHtml(base);
    for (const thing of [
      "annual general meeting",
      "conference and trade show",
      "Monthly member meetings",
      "benchmarking survey",
      "salary survey",
      "Circle",
      "Member Space",
    ]) {
      expect(html).toContain(thing);
    }
  });

  it("links Member Space at the given base url", () => {
    expect(buildMembershipValueHtml(base)).toContain('href="https://example.org/members"');
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
    expect(html).toContain("benchmarking survey");
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
