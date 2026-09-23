import { describe, it, expect } from "vitest";
import { resolveOptOutScope } from "@/lib/renewal/opt-out-scope";

/**
 * The rule that decides whether "Opt out of renewal" declines a future cycle
 * or cancels the membership in front of you.
 *
 * Written from the Langara College incident (2026-09): a member paid on
 * Sept 10 for the term ending 2027-08-31, clicked opt out on Sept 17, and the
 * old code cancelled the in-force term and wrote a $551.25 refund against a
 * payment that had arrived by cheque. Nothing they said asked to cancel.
 */
describe("which cycle an opt-out applies to", () => {
  it("leaves a paid, in-force term alone and defers to the NEXT cycle", () => {
    // ⛔ The exact Langara case. coverageInForce is what stops the cancel,
    // the refund, and the invoice void further down optOutOfRenewal.
    const scope = resolveOptOutScope("2027-08-31", "2026-09-17");
    expect(scope.coverageInForce).toBe(true);
    expect(scope.renewalYear).toBe(2028);
  });

  it("treats the last day of coverage as still in force", () => {
    // Someone opting out on their final covered day has still paid for it.
    const scope = resolveOptOutScope("2027-08-31", "2027-08-31");
    expect(scope.coverageInForce).toBe(true);
    expect(scope.renewalYear).toBe(2028);
  });

  it("cancels for a member in grace who never paid this cycle", () => {
    // Expired Aug 31, opting out three weeks into grace: this IS declining
    // the thing we are billing right now, so 2027 and a real cancellation.
    const scope = resolveOptOutScope("2026-08-31", "2026-09-22");
    expect(scope.coverageInForce).toBe(false);
    expect(scope.renewalYear).toBe(2027);
  });

  it("cancels for a member who has never completed a cycle", () => {
    const scope = resolveOptOutScope(null, "2026-09-22");
    expect(scope.coverageInForce).toBe(false);
    expect(scope.renewalYear).toBe(2027);
  });

  it("labels a pre-September opt-out with the current year", () => {
    // Before the Sept 1 cycle start, the cycle being billed is this year's.
    const scope = resolveOptOutScope("2026-08-31", "2026-07-04");
    expect(scope.coverageInForce).toBe(true);
    expect(scope.renewalYear).toBe(2027);
  });

  it("handles a full timestamp, not just a date", () => {
    const scope = resolveOptOutScope("2027-08-31T00:00:00+00:00", "2026-09-17");
    expect(scope.coverageInForce).toBe(true);
    expect(scope.renewalYear).toBe(2028);
  });
});
