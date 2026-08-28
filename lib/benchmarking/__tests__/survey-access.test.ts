import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let betaFlag: boolean | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: betaFlag === null ? null : { is_beta: betaFlag },
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { resolveSurveyAccess } from "../survey-access";

const ask = (surveyStatus: string, isAdmin = false) =>
  resolveSurveyAccess({
    surveyId: "s1",
    surveyStatus,
    organizationId: "org1",
    isAdmin,
  });

beforeEach(() => {
  betaFlag = null;
});

describe("who may file the survey", () => {
  it("open lets any member store file", async () => {
    expect(await ask("open")).toEqual({ canFile: true, reason: "open" });
  });

  it("beta lets a flagged store file", async () => {
    betaFlag = true;
    expect(await ask("beta")).toEqual({ canFile: true, reason: "beta" });
  });

  it("beta keeps everyone else out — this is the whole point", async () => {
    betaFlag = false;
    expect(await ask("beta")).toEqual({ canFile: false, reason: "not_in_beta" });
  });

  it("a store with no recipient row is not in the beta", async () => {
    betaFlag = null;
    expect(await ask("beta")).toEqual({ canFile: false, reason: "not_in_beta" });
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
    betaFlag = false;
    expect(await ask("beta", true)).toEqual({
      canFile: true,
      reason: "admin_preview",
    });
  });
});
