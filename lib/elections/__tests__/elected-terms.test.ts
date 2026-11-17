/**
 * The terms an election proposes.
 *
 * The dates are the whole of this file. They are NOT the real AGM date, and
 * that is a decision with a reason — a term starting on the meeting date leaves
 * a gap between the outgoing term's end and the incoming one's start, during
 * which the register reports the seat empty and the board below its by-law
 * minimum. Measured on the live data: on 2027-01-01 the board drops from 9
 * holders to 5 against a floor of 7.
 */
import { describe, it, expect } from "vitest";
import {
  proposeElectedTerms,
  nominalTermBoundary,
  TERM_LENGTH_YEARS,
  type ElectedPerson,
} from "../terms";

const person = (name: string): ElectedPerson => ({
  nominationId: `nom-${name}`,
  name,
  organizationName: `${name} College`,
  personContactId: `contact-${name}`,
  personProfileId: null,
  organizationId: `org-${name}`,
});

describe("nominal boundaries", () => {
  it("is January 1 of the year", () => {
    expect(nominalTermBoundary(2027)).toBe("2027-01-01");
  });

  it("pads a short year rather than producing a ragged date", () => {
    expect(nominalTermBoundary(999)).toBe("0999-01-01");
  });
});

describe("a term is two years, AGM to AGM", () => {
  it("runs from the cycle year to two years later", () => {
    const [t] = proposeElectedTerms({ cycleYear: 2027, elected: [person("Jackie")] });
    expect(t.termStart).toBe("2027-01-01");
    expect(t.termEnd).toBe("2029-01-01");
  });

  it("matches By-Law Part IV S2 — the second annual meeting following", () => {
    expect(TERM_LENGTH_YEARS).toBe(2);
  });

  it("starts exactly where the outgoing cohort ends, leaving no gap", () => {
    // The 2025 cohort runs to 2027-01-01. The 2027 cohort must start there.
    const outgoingEnd = nominalTermBoundary(2025 + TERM_LENGTH_YEARS);
    const [t] = proposeElectedTerms({ cycleYear: 2027, elected: [person("Jackie")] });
    expect(t.termStart).toBe(outgoingEnd);
  });

  it("counts toward the cap, because a general election is a full term", () => {
    const [t] = proposeElectedTerms({ cycleYear: 2027, elected: [person("Jackie")] });
    expect(t.countsTowardCap).toBe(true);
  });
});

describe("certifying twice seats nobody twice", () => {
  it("marks anyone already on the register", () => {
    const terms = proposeElectedTerms({
      cycleYear: 2027,
      elected: [person("Jackie"), person("Trish")],
      alreadyRecordedNominationIds: ["nom-Trish"],
    });
    expect(terms.find((t) => t.name === "Trish")?.alreadyRecorded).toBe(true);
    expect(terms.find((t) => t.name === "Jackie")?.alreadyRecorded).toBe(false);
  });

  it("keeps them in the list rather than dropping them silently", () => {
    const terms = proposeElectedTerms({
      cycleYear: 2027,
      elected: [person("Jackie")],
      alreadyRecordedNominationIds: ["nom-Jackie"],
    });
    expect(terms).toHaveLength(1);
  });

  it("treats an empty slate as an empty proposal, not an error", () => {
    expect(proposeElectedTerms({ cycleYear: 2027, elected: [] })).toEqual([]);
  });
});

describe("the person carried through", () => {
  it("keeps the contact id, which is what the register and the mailing list key on", () => {
    const [t] = proposeElectedTerms({ cycleYear: 2027, elected: [person("Jackie")] });
    expect(t.personContactId).toBe("contact-Jackie");
    expect(t.organizationId).toBe("org-Jackie");
  });

  it("tolerates a director with no login", () => {
    const [t] = proposeElectedTerms({ cycleYear: 2027, elected: [person("Jackie")] });
    expect(t.personProfileId).toBeNull();
  });
});
