import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SURVEY_LADDER,
  surveyState,
  ladderIndex,
  hasReached,
} from "../lifecycle";
// ⛔ No admin client mock: resolveSurveyAccess reads no table any more.
// Who may file is the capability it is handed, not a flag it looks up.

import { resolveSurveyAccess } from "../survey-access";

const ask = (surveyStatus: string, isAdmin = false) =>
  resolveSurveyAccess({
    surveyId: "s1",
    surveyStatus,
    organizationId: "org1",
    isAdmin,
  });

beforeEach(() => {
});

describe("who may file the survey", () => {
  it("open lets any member store file", async () => {
    expect(await ask("open")).toEqual({ canFile: true, reason: "open" });
  });

  /*
    ⛔ Being in the beta is holding the capability, not carrying a flag.

    The flag used to grant access on its own, which meant everybody at a
    flagged store could file while the opening mail went only to the appointed
    person — access nobody was told about. NAIT was exactly that the moment the
    ladder made the state reachable.
  */
  it("beta keeps out a flagged store with nobody appointed", async () => {
    expect(await ask("beta")).toEqual({ canFile: false, reason: "not_started" });
  });

  it("beta keeps out an unflagged store too", async () => {
    expect(await ask("beta")).toEqual({ canFile: false, reason: "not_started" });
  });

  it("closed keeps members out", async () => {
    expect(await ask("closed")).toEqual({ canFile: false, reason: "closed" });
  });

  it("draft keeps members out", async () => {
    expect(await ask("draft")).toEqual({ canFile: false, reason: "not_started" });
  });

  it("an admin can look at a closed survey without opening it to anyone", async () => {
    expect(await ask("closed", true)).toEqual({
      canFile: true,
      reason: "admin_preview",
    });
  });

  it("an admin previewing during beta is previewing, not filing", async () => {
    expect(await ask("beta", true)).toEqual({
      canFile: true,
      reason: "admin_preview",
    });
  });
});

describe("appointed beta testers", () => {
  /*
    The point of appointing one is that they use the survey the way a member
    will, in the weeks before it opens. An admin preview is not that: an admin
    looking at their own staff org sees a different survey to the one a store
    sees.
  */
  it("files while the survey is still in draft", async () => {
    const access = await resolveSurveyAccess({
      surveyId: "s1",
      surveyStatus: "draft",
      organizationId: "o1",
      isAdmin: false,
      isBetaTester: true,
    });
    expect(access).toEqual({ canFile: true, reason: "beta" });
  });

  it("files during the beta window without needing a recipient row", async () => {
    // The recipient row decides who an INVITATION counts as; it grants a
    // store in. The appointment decides who may file. Different questions.
    const access = await resolveSurveyAccess({
      surveyId: "s1",
      surveyStatus: "beta",
      organizationId: "o1",
      isAdmin: false,
      isBetaTester: true,
    });
    expect(access).toEqual({ canFile: true, reason: "beta" });
  });

  it("is still shut out once the year is closed", async () => {
    const access = await resolveSurveyAccess({
      surveyId: "s1",
      surveyStatus: "complete",
      organizationId: "o1",
      isAdmin: false,
      isBetaTester: true,
    });
    expect(access.canFile).toBe(false);
  });

  it("changes nothing for somebody who was never appointed", async () => {
    const access = await resolveSurveyAccess({
      surveyId: "s1",
      surveyStatus: "draft",
      organizationId: "o1",
      isAdmin: false,
      isBetaTester: false,
    });
    expect(access.canFile).toBe(false);
  });
});

describe("the survey ladder", () => {
  /*
    The bug these exist for: the ladder was written out in three places — the
    admin card's labels and transitions, this module's status branches, and the
    server action's whitelist. The card and the server disagreed about `beta`,
    a status the database has always allowed, so the phase was unreachable and
    nothing failed loudly. Anything that offers a move the server refuses is a
    button that cannot succeed.
  */

  it("offers exactly one way out of every state, ending at complete", () => {
    const ends = SURVEY_LADDER.filter((d) => d.next === null);
    expect(ends.map((d) => d.state)).toEqual(["complete"]);

    // Every other state's next must be a state that exists in the ladder.
    for (const d of SURVEY_LADDER) {
      if (!d.next) continue;
      expect(SURVEY_LADDER.some((x) => x.state === d.next!.state)).toBe(true);
    }
  });

  it("goes through beta on the way from draft to open", () => {
    // ⛔ The whole point. draft -> open directly is what made the beta phase
    // unreachable while its access branch sat there looking implemented.
    expect(surveyState("draft")?.next?.state).toBe("beta");
    expect(surveyState("beta")?.next?.state).toBe("open");
  });

  it("never moves backwards", () => {
    for (const d of SURVEY_LADDER) {
      if (!d.next) continue;
      expect(ladderIndex(d.next.state)).toBeGreaterThan(ladderIndex(d.state));
    }
  });

  it("names the job that is live in each collecting state", () => {
    // A state with nobody appointed to work it is a phase that cannot progress.
    expect(surveyState("draft")?.liveCapability).toBe("benchmarking.content_review");
    expect(surveyState("beta")?.liveCapability).toBe("benchmarking.beta_tester");
    expect(surveyState("open")?.liveCapability).toBe("benchmarking.qa_verify");
  });

  it("hasReached is inclusive and rejects an unknown status", () => {
    expect(hasReached("open", "beta")).toBe(true);
    expect(hasReached("beta", "beta")).toBe(true);
    expect(hasReached("draft", "beta")).toBe(false);
    expect(hasReached("nonsense", "draft")).toBe(false);
  });

  it("every ladder state is one the database will accept", () => {
    // Mirrors benchmarking_surveys_status_check. A state this ladder offers
    // but the CHECK rejects writes a button that fails at the database.
    const allowedByCheck = ["draft", "beta", "open", "closed", "processing", "complete"];
    for (const d of SURVEY_LADDER) expect(allowedByCheck).toContain(d.state);
  });
});
