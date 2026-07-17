import { describe, expect, it } from "vitest";

import {
  computeLaunchReadiness,
  launchBlockers,
  type LaunchReadinessInput,
} from "../launch-readiness";

function input(overrides: Partial<LaunchReadinessInput> = {}): LaunchReadinessInput {
  return {
    startDate: "2027-02-01",
    endDate: "2027-02-04",
    registrationOpenAt: "2026-09-01 00:00:00",
    registrationCloseAt: "2027-01-15 00:00:00",
    dayCount: 4,
    taxRatePct: 13,
    stripeTaxRateId: "txr_1",
    legalVersionCount: 1,
    v3ThingCount: 3,
    v3OpenQuestionCount: 0,
    v3ForSaleCount: 1,
    ...overrides,
  };
}

function checkById(readiness: ReturnType<typeof computeLaunchReadiness>, id: string) {
  return readiness.stages.flatMap((s) => s.checks).find((c) => c.id === id);
}

describe("computeLaunchReadiness", () => {
  it("clears a fully configured conference for sale", () => {
    const r = computeLaunchReadiness(input());
    expect(r.canGoOnSale).toBe(true);
    expect(r.blockingCount).toBe(0);
    expect(r.stages.map((s) => s.key)).toEqual(["describe", "package", "sell"]);
  });

  it("ignores the v3 Build catalog when the conference never used it", () => {
    const r = computeLaunchReadiness(input({ v3ThingCount: 0, v3OpenQuestionCount: 3 }));
    expect(checkById(r, "build-open-questions")).toBeUndefined();
  });

  it("blocks go-on-sale when the v3 Build catalog has open questions", () => {
    const r = computeLaunchReadiness(input({ v3ThingCount: 8, v3OpenQuestionCount: 2 }));
    const check = checkById(r, "build-open-questions");
    expect(check?.status).toBe("blocked");
    expect(r.canGoOnSale).toBe(false);
  });

  it("passes when the v3 Build catalog has things and no open questions", () => {
    const r = computeLaunchReadiness(input({ v3ThingCount: 8, v3OpenQuestionCount: 0 }));
    expect(checkById(r, "build-open-questions")?.status).toBe("ok");
    expect(r.canGoOnSale).toBe(true);
  });

  it("blocks on missing dates and reports it under Describe", () => {
    const r = computeLaunchReadiness(input({ startDate: null, endDate: null, dayCount: 0 }));
    expect(r.canGoOnSale).toBe(false);
    expect(checkById(r, "dates")?.status).toBe("blocked");
    expect(r.stages.find((s) => s.key === "describe")?.status).toBe("blocked");
  });

  it("blocks an inverted registration window", () => {
    const r = computeLaunchReadiness(
      input({ registrationOpenAt: "2027-01-15 00:00:00", registrationCloseAt: "2026-09-01 00:00:00" })
    );
    expect(checkById(r, "registration-window")?.status).toBe("blocked");
    expect(r.canGoOnSale).toBe(false);
  });

  it("warns (does not block) when registration closes after the conference starts", () => {
    const r = computeLaunchReadiness(input({ registrationCloseAt: "2027-02-03 00:00:00" }));
    expect(checkById(r, "registration-after-start")?.status).toBe("warning");
    expect(r.canGoOnSale).toBe(true);
  });

  it("blocks when nothing in the v3 catalog is for sale", () => {
    const r = computeLaunchReadiness(input({ v3ForSaleCount: 0 }));
    expect(checkById(r, "for-sale")?.status).toBe("blocked");
    expect(r.canGoOnSale).toBe(false);
  });

  it("clears the for-sale check once a thing is for sale", () => {
    const r = computeLaunchReadiness(input({ v3ForSaleCount: 2 }));
    expect(checkById(r, "for-sale")?.status).toBe("ok");
  });

  it("blocks without legal docs (and meeting setup is no longer a launch blocker)", () => {
    const r = computeLaunchReadiness(input({ legalVersionCount: 0 }));
    expect(checkById(r, "legal")?.status).toBe("blocked");
    // The retired conference_parameters check no longer exists.
    expect(checkById(r, "parameters")).toBeUndefined();
    expect(r.canGoOnSale).toBe(false);
  });

  it("warns when a tax rate is set without a Stripe rate id", () => {
    const r = computeLaunchReadiness(input({ stripeTaxRateId: null }));
    expect(checkById(r, "tax")?.status).toBe("warning");
    expect(r.canGoOnSale).toBe(true);
  });

  it("treats a fully unset tax as info, not a blocker", () => {
    const r = computeLaunchReadiness(input({ taxRatePct: null, stripeTaxRateId: null }));
    expect(checkById(r, "tax")?.status).toBe("info");
    expect(r.canGoOnSale).toBe(true);
  });

  it("launchBlockers lists exactly the blocking checks", () => {
    const r = computeLaunchReadiness(input({ startDate: null, endDate: null, legalVersionCount: 0 }));
    const blockers = launchBlockers(r);
    expect(blockers.length).toBe(r.blockingCount);
    expect(blockers.some((b) => b.startsWith("Legal documents:"))).toBe(true);
  });
});
