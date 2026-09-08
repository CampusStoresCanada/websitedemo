import { describe, it, expect, vi } from "vitest";

// renewal-activation (imported transitively for isWithinPreRenewalSkipWindow)
// pulls lib/stripe/client, which throws at module scope when STRIPE_SECRET_KEY
// is unset. Nothing under test touches Stripe.
vi.mock("@/lib/stripe/client", () => ({ stripe: {} }));

const { currentProrationDiscountPct, effectiveProrationDiscountPct, applyDiscountPct } =
  await import("../proration");
const { nextCycleStartOnOrAfter, isWithinPreRenewalSkipWindow } = await import(
  "@/lib/membership/renewal-activation"
);

// The live policy values as of 2026-09: a Sept 1 membership year, a 90-day
// pre-renewal skip window, and a two-rung late-join ladder.
const CYCLE = "09-01";
const SKIP_DAYS = 90;
const RULES = [
  { after_month_day: "02-04", discount_pct: 50 },
  { after_month_day: "06-01", discount_pct: 75 },
];
const PARTNER_RATE_CENTS = 60000;

/** Mid-afternoon UTC, matching how a real checkout timestamp arrives. */
const at = (iso: string) => new Date(`${iso}T15:00:00Z`);

const priceCents = (iso: string) =>
  applyDiscountPct(
    PARTNER_RATE_CENTS,
    effectiveProrationDiscountPct(RULES, CYCLE, SKIP_DAYS, at(iso))
  );

describe("nextCycleStartOnOrAfter", () => {
  it("returns the cycle-start day itself, not next year, on the day", () => {
    // The regression: comparing a midnight candidate against a timestamped
    // `now` made "on or after" false for all but the first instant of the day.
    expect(nextCycleStartOnOrAfter(at("2026-09-01"), CYCLE)).toBe("2026-09-01");
    expect(nextCycleStartOnOrAfter(new Date("2026-09-01T00:00:00Z"), CYCLE)).toBe("2026-09-01");
    expect(nextCycleStartOnOrAfter(new Date("2026-09-01T23:59:59Z"), CYCLE)).toBe("2026-09-01");
  });

  it("rolls forward the day after", () => {
    expect(nextCycleStartOnOrAfter(at("2026-09-02"), CYCLE)).toBe("2027-09-01");
  });

  it("still counts down within the same cycle", () => {
    expect(nextCycleStartOnOrAfter(at("2026-08-31"), CYCLE)).toBe("2026-09-01");
    expect(nextCycleStartOnOrAfter(at("2027-01-15"), CYCLE)).toBe("2027-09-01");
  });
});

describe("currentProrationDiscountPct — measured within the cycle", () => {
  it("gives no late-join discount at the START of the membership year", () => {
    // September through December are months 0-4 of a Sept 1 cycle. The old
    // calendar comparison read them as "month 9 > month 6" and handed out the
    // 75% end-of-year discount.
    for (const day of ["2026-09-01", "2026-09-02", "2026-10-15", "2026-11-30", "2026-12-31"]) {
      expect(currentProrationDiscountPct(RULES, CYCLE, at(day))).toBe(0);
    }
  });

  it("holds full price up to the first rung", () => {
    expect(currentProrationDiscountPct(RULES, CYCLE, at("2027-01-01"))).toBe(0);
    expect(currentProrationDiscountPct(RULES, CYCLE, at("2027-02-03"))).toBe(0);
  });

  it("applies each rung once the cycle reaches it", () => {
    expect(currentProrationDiscountPct(RULES, CYCLE, at("2027-02-04"))).toBe(50);
    expect(currentProrationDiscountPct(RULES, CYCLE, at("2027-05-31"))).toBe(50);
    expect(currentProrationDiscountPct(RULES, CYCLE, at("2027-06-01"))).toBe(75);
    expect(currentProrationDiscountPct(RULES, CYCLE, at("2027-08-31"))).toBe(75);
  });

  it("returns 0 when no rules are configured", () => {
    expect(currentProrationDiscountPct([], CYCLE, at("2027-06-15"))).toBe(0);
  });

  it("reads the date in UTC, not the runtime's local zone", () => {
    // 18:00 Mountain on Feb 3 is Feb 4 UTC. The cycle system is UTC
    // throughout; local-time reading moved this boundary by a day.
    expect(currentProrationDiscountPct(RULES, CYCLE, new Date("2027-02-04T01:00:00Z"))).toBe(50);
  });
});

describe("prospective partner dues across a full cycle", () => {
  it("charges a new partner the full rate for the first four months", () => {
    // 2026-09-01 is the JVCKENWOOD booth purchase: billed $150 for a $600
    // partnership because the skip window switched off and the ladder
    // simultaneously read September as end-of-year.
    expect(priceCents("2026-09-01")).toBe(60000);
    expect(priceCents("2026-09-02")).toBe(60000);
    expect(priceCents("2026-12-31")).toBe(60000);
  });

  it("still discounts a genuine late join", () => {
    expect(priceCents("2027-02-04")).toBe(30000);
    expect(priceCents("2027-05-31")).toBe(30000);
  });

  it("sells the year ahead at full price inside the skip window", () => {
    expect(isWithinPreRenewalSkipWindow(at("2027-06-03"), CYCLE, SKIP_DAYS)).toBe(true);
    expect(priceCents("2027-06-03")).toBe(60000);
    expect(priceCents("2027-08-31")).toBe(60000);
  });

  it("leaves August pricing exactly as the five pre-Sept booth buyers paid it", () => {
    for (const day of ["2026-08-12", "2026-08-18", "2026-08-24", "2026-08-26"]) {
      expect(priceCents(day)).toBe(60000);
    }
  });
});
