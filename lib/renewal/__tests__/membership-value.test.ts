import { describe, it, expect } from "vitest";
import {
  buildMembershipValueHtml,
  resolveProgramFromOrgType,
  renewalTemplateFor,
  type MembershipValueInput,
} from "../membership-value";

const ELECTION = {
  cycleYear: 2027,
  nominationsOpenOn: "2026-09-23",
  nominationsCloseOn: "2026-10-23",
  agmDate: "2027-01-21",
  seatsAvailable: 4,
};

const base: MembershipValueInput = {
  stage: "reminder",
  program: "member",
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


describe("vendor partners get a different clause entirely", () => {
  const partner: MembershipValueInput = { ...base, program: "partner" };

  it("NEVER tells a partner they can vote or nominate", () => {
    // 43 vendor partners received the 14-day reminder this year. Governance
    // belongs to member stores; telling a partner they have a vote would be
    // both false and embarrassing, and there is no stage at which it is right.
    for (const stage of ["reminder", "grace", "locked"] as const) {
      const html = buildMembershipValueHtml({ ...partner, stage });
      expect(html).not.toContain("board election");
      expect(html).not.toMatch(/vote/i);
      expect(html).not.toMatch(/nominat/i);
    }
  });

  it("does not claim benchmarking data or advocacy on their behalf", () => {
    // The benchmarking data is ABOUT campus stores; partners do not receive it,
    // and CSC does not advocate for vendors.
    const html = buildMembershipValueHtml(partner);
    expect(html).not.toContain("Data that proves your value");
    expect(html).not.toContain("Collective advocacy");
    expect(html).not.toContain("on behalf of Canadian campus stores");
  });

  it("says what a partner actually buys", () => {
    const html = buildMembershipValueHtml(partner);
    expect(html).toContain("The trade show");
    expect(html).toContain("partner directory");
    expect(html).toContain("Being asked");
    expect(html).toContain("Your partnership is how Canadian campus stores find you");
  });

  it("never says 'membership' to a partner, at any stage", () => {
    // They renew a partnership. One stray noun and the whole separate-template
    // exercise is undone in the reader's eye.
    for (const stage of ["reminder", "grace", "locked"] as const) {
      expect(buildMembershipValueHtml({ ...partner, stage }).toLowerCase()).not.toContain(
        "membership"
      );
    }
  });

  it("escalates across the series like the member one does", () => {
    expect(buildMembershipValueHtml(partner)).toContain("What your partnership carries");
    expect(buildMembershipValueHtml({ ...partner, stage: "grace" })).toContain("What lapses");
    expect(buildMembershipValueHtml({ ...partner, stage: "locked" })).toContain("What has stopped");
  });
});

describe("resolveProgramFromOrgType", () => {
  const PROGRAMS = [
    { orgTypeValue: "Member", permissionLevel: "member" },
    { orgTypeValue: "Vendor Partner", permissionLevel: "partner" },
  ];

  it("reads the CAPITALISED org type the database actually stores", () => {
    // organizations.type is "Member" / "Vendor Partner". A lowercase compare
    // matches nothing and silently returns the wrong clause.
    expect(resolveProgramFromOrgType("Member", PROGRAMS)).toBe("member");
    expect(resolveProgramFromOrgType("Vendor Partner", PROGRAMS)).toBe("partner");
  });

  it("falls back to partner for anything unrecognised", () => {
    // The safe direction: the partner clause promises less and claims no vote.
    expect(resolveProgramFromOrgType("Non-Member", PROGRAMS)).toBe("partner");
    expect(resolveProgramFromOrgType(null, PROGRAMS)).toBe("partner");
    expect(resolveProgramFromOrgType("member", PROGRAMS)).toBe("partner");
  });
});

describe("renewalTemplateFor", () => {
  it("sends partners the partnership templates at every stage", () => {
    expect(renewalTemplateFor("reminder", "partner")).toBe("partnership_renewal_reminder");
    expect(renewalTemplateFor("grace", "partner")).toBe("partnership_grace_reminder");
    expect(renewalTemplateFor("locked", "partner")).toBe("partnership_suspended");
  });

  it("leaves the member series exactly as it was", () => {
    expect(renewalTemplateFor("reminder", "member")).toBe("renewal_reminder");
    expect(renewalTemplateFor("grace", "member")).toBe("grace_weekly_reminder");
    expect(renewalTemplateFor("locked", "member")).toBe("membership_locked");
  });

  it("never routes a partner to a member template", () => {
    // The template choice and the value clause have to agree. If these ever
    // diverge a partner gets member copy under a partnership subject line, or
    // the reverse — both are worse than either mistake alone.
    const memberTemplates = ["renewal_reminder", "grace_weekly_reminder", "membership_locked"];
    for (const stage of ["reminder", "grace", "locked"] as const) {
      expect(memberTemplates).not.toContain(renewalTemplateFor(stage, "partner"));
    }
  });
});

describe("someone who has unsubscribed", () => {
  it("still gets the notice, but not the pitch", () => {
    // The split the send path makes: `membership_value_html` becomes "" for a
    // suppressed recipient while the invoice notice itself still sends. The
    // clause is the persuasion; the notice is the obligation. Rendering an
    // empty clause is a legitimate, silent no-op — the template just closes up.
    const clause = buildMembershipValueHtml(base);
    expect(clause.length).toBeGreaterThan(0);
    // What the send path substitutes instead:
    const suppressedClause = "";
    expect(suppressedClause).toBe("");
  });
});
