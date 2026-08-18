/**
 * Phase 0 baseline — see ~/.claude/plans/membership-terms-and-programs.md
 *
 * Freezes how renewal dates are derived TODAY, so the upcoming move to
 * per-program terms (fixed-cycle vs anniversary) can be proven behaviour-
 * neutral before any swap. Every value below was captured on 2026-08-18 by
 * running the real code against the live policy set.
 *
 * The config is stubbed rather than read, deliberately: once
 * `programs.definitions` is editable in /admin/policy, an admin changing the
 * live fiscal cycle must NOT turn this suite red. It asserts the behaviour of
 * the derivation given a known config — not what the current deployment
 * happens to be configured to.
 *
 * The clock is frozen for the same reason: `computeNewExpiresAt` anchors a
 * late join to `new Date()`, so these values are only reproducible at a fixed
 * "today".
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Live values from policy_values (active set), captured 2026-08-18.
const CYCLE_START_MONTH_DAY = "09-01";
const PRE_RENEWAL_SKIP_STUB_DAYS = 90;
const TODAY = "2026-08-18";

// renewal-activation pulls in Stripe + Supabase at module scope. Nothing here
// makes a network call; these just keep the import graph from throwing.
vi.mock("@/lib/stripe/client", () => ({ stripe: {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/membership/state-machine", () => ({
  transitionMembershipState: vi.fn(),
}));
vi.mock("@/lib/renewal/events", () => ({ recordRenewalEvent: vi.fn() }));

vi.mock("@/lib/policy/engine", () => ({
  getRenewalConfig: vi.fn(async () => ({
    cycle_start_month_day: CYCLE_START_MONTH_DAY,
    pre_renewal_skip_stub_days: PRE_RENEWAL_SKIP_STUB_DAYS,
    reminder_days: [30, 14, 7, 0],
    grace_days: 30,
    reactivation_days: 330,
    refund_window_days: 30,
    access_lock_mode: "full_lock",
    dispatch_time: "07:00",
    dispatch_timezone: "America/Toronto",
  })),
}));

import {
  computeNewExpiresAt,
  cyclesNeededFrom,
  isWithinPreRenewalSkipWindow,
} from "../renewal-activation";

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("computeNewExpiresAt — fixed fiscal cycle (09-01) baseline", () => {
  // [label, currentExpiresAt, mustCoverThrough, expected]
  const cases: Array<
    [string, string | null, string | null, {
      billingPeriodStart: string;
      billingPeriodEnd: string;
      isLateJoin: boolean;
      cyclesBridged: number;
    }]
  > = [
    ["never joined", null, null, {
      billingPeriodStart: "2026-08-18", billingPeriodEnd: "2026-08-31",
      isLateJoin: true, cyclesBridged: 1,
    }],
    ["lapsed expiry", "2025-08-31", null, {
      billingPeriodStart: "2026-08-18", billingPeriodEnd: "2026-08-31",
      isLateJoin: true, cyclesBridged: 1,
    }],
    ["current expiry extends from its own boundary", "2027-08-31", null, {
      billingPeriodStart: "2027-08-31", billingPeriodEnd: "2028-08-31",
      isLateJoin: false, cyclesBridged: 1,
    }],
    ["never joined, must cover a conference", null, "2027-06-15", {
      billingPeriodStart: "2026-08-18", billingPeriodEnd: "2027-08-31",
      isLateJoin: true, cyclesBridged: 2,
    }],
    ["current expiry already covers the conference", "2027-08-31", "2028-06-15", {
      billingPeriodStart: "2027-08-31", billingPeriodEnd: "2028-08-31",
      isLateJoin: false, cyclesBridged: 1,
    }],
    ["lapsed, bridging multiple cycles to reach a conference", "2025-08-31", "2028-06-15", {
      billingPeriodStart: "2026-08-18", billingPeriodEnd: "2028-08-31",
      isLateJoin: true, cyclesBridged: 3,
    }],
  ];

  for (const [label, current, cover, expected] of cases) {
    it(label, async () => {
      await expect(computeNewExpiresAt(current, cover)).resolves.toEqual(expected);
    });
  }

  it("produces a short stub for a join late in the cycle", async () => {
    // 13 days, 2026-08-18 -> 2026-08-31. The stub is NOT resolved here: the
    // skip decision lives in this function's CALLERS, each of which calls
    // isWithinPreRenewalSkipWindow independently. Consolidating that is the
    // point of Phase 4 — this assertion pins the pre-consolidation behaviour.
    const r = await computeNewExpiresAt(null, null);
    const days =
      (Date.parse(`${r.billingPeriodEnd}T00:00:00Z`) -
        Date.parse(`${r.billingPeriodStart}T00:00:00Z`)) /
      86_400_000;
    expect(days).toBe(13);
  });
});

describe("isWithinPreRenewalSkipWindow — 90 days before 09-01", () => {
  const cases: Array<[string, boolean]> = [
    ["2026-08-18", true],
    ["2026-06-15", true],
    ["2026-02-04", false],
    ["2025-12-01", false],
  ];

  for (const [day, expected] of cases) {
    it(`${day} -> ${expected}`, () => {
      expect(
        isWithinPreRenewalSkipWindow(
          new Date(`${day}T00:00:00Z`),
          CYCLE_START_MONTH_DAY,
          PRE_RENEWAL_SKIP_STUB_DAYS
        )
      ).toBe(expected);
    });
  }
});

describe("cyclesNeededFrom", () => {
  it("counts boundaries from a known anchor without late-join judgment", async () => {
    await expect(cyclesNeededFrom("2026-08-31", "2028-06-15")).resolves.toBe(2);
  });
});
