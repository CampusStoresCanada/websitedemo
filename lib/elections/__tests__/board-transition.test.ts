/**
 * Moving access when the board changes over.
 *
 * ⛔ The trap this exists to avoid: three of the four people standing in 2027
 * are incumbents whose terms end at the same AGM. They appear on BOTH lists.
 * Treating that as "remove then re-add" would strip and restore live
 * administrator accounts for no reason, and leave an audit trail saying so.
 */
import { describe, it, expect } from "vitest";
import {
  buildTransitionPlan,
  resolveEffectiveDate,
  termsEndingBy,
  latestTermPerPerson,
  type TransitionPerson,
} from "../transition";

const person = (name: string, over: Partial<TransitionPerson> = {}): TransitionPerson => ({
  contactId: name,
  profileId: `p-${name}`,
  name,
  email: `${name}@example.invalid`,
  organizationName: "Somewhere",
  alreadyHasAccess: false,
  protectedRole: false,
  ...over,
});

describe("who is actually moving", () => {
  it("counts an incumbent re-elected as continuing, not out-and-in", () => {
    const kack = person("Kack", { alreadyHasAccess: true });
    const plan = buildTransitionPlan({
      elected: [kack, person("Nguyen")],
      termEndingAtThisAgm: [kack, person("Davies", { alreadyHasAccess: true })],
    });

    expect(plan.continuing.map((p) => p.name)).toEqual(["Kack"]);
    expect(plan.incoming.map((p) => p.name)).toEqual(["Nguyen"]);
    expect(plan.outgoing.map((p) => p.name)).toEqual(["Davies"]);
  });

  it("never lists the same person as both incoming and outgoing", () => {
    const kack = person("Kack", { alreadyHasAccess: true });
    const plan = buildTransitionPlan({ elected: [kack], termEndingAtThisAgm: [kack] });
    expect(plan.incoming).toEqual([]);
    expect(plan.outgoing).toEqual([]);
  });

  it("is a no-op when nobody's access would change", () => {
    const kack = person("Kack", { alreadyHasAccess: true });
    expect(buildTransitionPlan({ elected: [kack], termEndingAtThisAgm: [kack] }).noop).toBe(true);
  });

  it("is not a no-op when somebody new needs access", () => {
    const plan = buildTransitionPlan({ elected: [person("Nguyen")], termEndingAtThisAgm: [] });
    expect(plan.noop).toBe(false);
  });

  it("does not count a protected role as a revoke", () => {
    // The Executive Director holds admin because of the job. A board
    // transition that demoted them would lock CSC out of its own console.
    const ed = person("ED", { alreadyHasAccess: true, protectedRole: true });
    const plan = buildTransitionPlan({ elected: [], termEndingAtThisAgm: [ed] });
    expect(plan.outgoing.map((p) => p.name)).toEqual(["ED"]);
    expect(plan.noop).toBe(true);
  });
});

describe("when it takes effect", () => {
  const dates = { agmDate: "2027-01-21", conferenceEndsOn: "2027-06-14", custom: null };

  it("resolves the meeting", () => {
    expect(resolveEffectiveDate("agm", dates).date).toBe("2027-01-21");
  });

  it("resolves the end of the next conference", () => {
    expect(resolveEffectiveDate("after_conference", dates).date).toBe("2027-06-14");
  });

  it("says so rather than guessing when no conference is on record", () => {
    const r = resolveEffectiveDate("after_conference", { ...dates, conferenceEndsOn: null });
    expect(r.date).toBeNull();
    expect(r.problem).toContain("Pick a custom date");
  });

  it("takes a custom date, and refuses a malformed one", () => {
    expect(resolveEffectiveDate("custom", { ...dates, custom: "2027-03-01" }).date).toBe(
      "2027-03-01"
    );
    expect(resolveEffectiveDate("custom", { ...dates, custom: "March" }).date).toBeNull();
  });
});

describe("one row per person, the term they hold now", () => {
  // ⚠️ Every case here is a real row shape from the live register. Filtering
  // term_end directly produced fourteen "outgoing" directors out of ten
  // people, five of whom were continuing — caught by running it against real
  // data, not by a fixture.
  const row = (contactId: string, termEnd: string | null) => ({
    contactId,
    termEnd,
    name: contactId,
    organizationName: "Somewhere",
  });

  it("collapses a director's several past terms into one", () => {
    const rows = [
      row("Kack", "2023-01-01"),
      row("Kack", "2025-01-01"),
      row("Kack", "2027-01-01"),
    ];
    expect(latestTermPerPerson(rows)).toHaveLength(1);
    expect(latestTermPerPerson(rows)[0].termEnd).toBe("2027-01-01");
  });

  it("does not call a continuing director outgoing because of an older term", () => {
    // Sean Bell: served 2024-2026, re-elected through 2028. The old term ended
    // before this AGM; he is not going anywhere.
    const rows = [row("Bell", "2026-01-01"), row("Bell", "2028-01-01")];
    expect(termsEndingBy(rows, "2027-01-21")).toEqual([]);
  });

  it("finds the ones whose current term really does end", () => {
    const rows = [
      row("Davies", "2027-01-01"),
      row("Bell", "2026-01-01"),
      row("Bell", "2028-01-01"),
    ];
    expect(termsEndingBy(rows, "2027-01-21").map((r) => r.contactId)).toEqual(["Davies"]);
  });

  it("treats an open-ended term as outranking any date", () => {
    const rows = [row("Officer", "2026-01-01"), row("Officer", null)];
    expect(latestTermPerPerson(rows)[0].termEnd).toBeNull();
    expect(termsEndingBy(rows, "2027-01-21")).toEqual([]);
  });

  it("keeps an open-ended term whichever order the rows arrive in", () => {
    expect(latestTermPerPerson([row("X", null), row("X", "2026-01-01")])[0].termEnd).toBeNull();
    expect(latestTermPerPerson([row("X", "2026-01-01"), row("X", null)])[0].termEnd).toBeNull();
  });
});
