import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("../client", () => ({ stripe: {} }));
vi.mock("@/lib/comms/send", () => ({ sendTransactional: vi.fn() }));

import { stripeDueTerms } from "../billing";

/**
 * Every invoice the site sends gets its terms here: 30 days, or a date CSC
 * agreed to (Kivuto, 2026-11: invoiced Nov 12, due Jan 1). Stripe fixes the
 * date at finalization, so a wrong one cannot be corrected after sending.
 */
describe("stripeDueTerms", () => {
  afterEach(() => vi.useRealTimers());

  it("is 30 days when no date was agreed", () => {
    expect(stripeDueTerms()).toEqual({ days_until_due: 30 });
    expect(stripeDueTerms("")).toEqual({ days_until_due: 30 });
  });

  it("falls due on the agreed date in the Stripe account's timezone", () => {
    vi.useFakeTimers({ now: new Date("2026-11-12T16:00:00Z") });
    const terms = stripeDueTerms("2027-01-01");
    expect(terms).toHaveProperty("due_date");
    const at = new Date((terms as { due_date: number }).due_date * 1000);
    expect(at.toLocaleDateString("en-CA", { timeZone: "America/Edmonton" })).toBe("2027-01-01");
    expect(at.toLocaleDateString("en-CA", { timeZone: "America/Toronto" })).toBe("2027-01-01");
    expect(at.toLocaleDateString("en-CA", { timeZone: "America/Vancouver" })).toBe("2027-01-01");
  });

  it("refuses today or a past date, which would send an invoice already due", () => {
    vi.useFakeTimers({ now: new Date("2026-11-12T16:00:00Z") });
    expect(() => stripeDueTerms("2026-11-12")).toThrow(/after today/);
    expect(() => stripeDueTerms("2026-10-01")).toThrow(/after today/);
  });

  it("refuses anything that is not a calendar date", () => {
    expect(() => stripeDueTerms("Jan 1")).toThrow(/YYYY-MM-DD/);
  });
});
