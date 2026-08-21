import { describe, it, expect } from "vitest";
import { CSC_ELECTIONS_CONFIG } from "../config";
import { validateBallot, orderCandidates, describeLastEdit } from "../ballot";

const CANDIDATES = ["a", "b", "c", "d", "e"];
const SEATS = 4;

describe("validateBallot", () => {
  it("accepts a full slate", () => {
    const v = validateBallot({ selections: ["a", "b", "c", "d"], abstain: false }, CANDIDATES, SEATS, CSC_ELECTIONS_CONFIG);
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("rejects more selections than seats", () => {
    const v = validateBallot({ selections: CANDIDATES, abstain: false }, CANDIDATES, SEATS, CSC_ELECTIONS_CONFIG);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toMatch(/at most 4/);
  });

  it("rejects duplicates", () => {
    const v = validateBallot({ selections: ["a", "a"], abstain: false }, CANDIDATES, SEATS, CSC_ELECTIONS_CONFIG);
    expect(v.errors.join(" ")).toMatch(/more than once/);
  });

  it("rejects a candidate not on the ballot", () => {
    const v = validateBallot({ selections: ["ghost"], abstain: false }, CANDIDATES, SEATS, CSC_ELECTIONS_CONFIG);
    expect(v.errors.join(" ")).toMatch(/not on the ballot/);
  });

  it("treats abstain as exclusive of any selection", () => {
    const v = validateBallot({ selections: ["a"], abstain: true }, CANDIDATES, SEATS, CSC_ELECTIONS_CONFIG);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toMatch(/cannot also select/);
  });

  it("accepts a plain abstention", () => {
    expect(validateBallot({ selections: [], abstain: true }, CANDIDATES, SEATS, CSC_ELECTIONS_CONFIG).valid).toBe(true);
  });

  it("warns rather than errors on an undervote", () => {
    const v = validateBallot({ selections: ["a"], abstain: false }, CANDIDATES, SEATS, CSC_ELECTIONS_CONFIG);
    expect(v.valid).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/1 of 4 selections used/);
  });

  it("warns that an empty non-abstention ballot counts for nobody", () => {
    const v = validateBallot({ selections: [], abstain: false }, CANDIDATES, SEATS, CSC_ELECTIONS_CONFIG);
    expect(v.valid).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/will not count toward any candidate/);
  });

  it("errors on an undervote where the config forbids one", () => {
    const strict = { ...CSC_ELECTIONS_CONFIG, ballot: { ...CSC_ELECTIONS_CONFIG.ballot, allowUndervote: false } };
    expect(validateBallot({ selections: ["a"], abstain: false }, CANDIDATES, SEATS, strict).valid).toBe(false);
  });
});

describe("presentation", () => {
  it("orders candidates alphabetically per Part V S3(a)", () => {
    const ordered = orderCandidates(
      [{ displayName: "Willis, Sam" }, { displayName: "Bell, Sean" }, { displayName: "Kack, Jason" }],
      CSC_ELECTIONS_CONFIG
    );
    expect(ordered.map((c) => c.displayName)).toEqual(["Bell, Sean", "Kack, Jason", "Willis, Sam"]);
  });

  it("names the last editor so a co-edit is never a silent clobber", () => {
    expect(describeLastEdit("Trish Linden-Teasdale", "2026-11-24T21:41:00Z", () => "Nov 24 at 2:41 PM MST"))
      .toBe("Last saved by Trish Linden-Teasdale on Nov 24 at 2:41 PM MST.");
    expect(describeLastEdit(null, null, () => "")).toBeNull();
  });
});
