/**
 * The board register: who holds a seat, and on which days.
 *
 * The real bugs here are all boundaries. `term_end` is exclusive, a
 * no-prior-service marker is a zero-length row that must never count as a
 * seat, and these three governance tables read EMPTY through a session client
 * because RLS is on with no policies — a reader that used the wrong client
 * would report an empty board and no error at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { holdsOn } from "../register";

const source = readFileSync("lib/governance/register.ts", "utf8");

const term = (termStart: string, termEnd: string | null, isNoServiceMarker = false) => ({
  termStart,
  termEnd,
  isNoServiceMarker,
});

describe("term_end is exclusive", () => {
  it("holds on the day before it ends", () => {
    expect(holdsOn(term("2025-01-01", "2027-01-01"), "2026-12-31")).toBe(true);
  });

  it("does NOT hold on the end date itself", () => {
    expect(holdsOn(term("2025-01-01", "2027-01-01"), "2027-01-01")).toBe(false);
  });

  it("holds on the first day of the term", () => {
    expect(holdsOn(term("2027-01-01", "2029-01-01"), "2027-01-01")).toBe(true);
  });

  it("does not hold the day before it starts", () => {
    expect(holdsOn(term("2027-01-01", "2029-01-01"), "2026-12-31")).toBe(false);
  });

  it("an open-ended term holds indefinitely", () => {
    expect(holdsOn(term("2026-01-01", null), "2099-01-01")).toBe(true);
  });
});

describe("a no-prior-service marker is not a seat", () => {
  it("never holds, even on its own date", () => {
    expect(holdsOn(term("2026-09-28", "2026-09-28", true), "2026-09-28")).toBe(false);
  });

  it("is detected the same way the elections service detects it", () => {
    // Zero-length AND not counting. Both halves matter: a one-day real term
    // that counted would be a different thing entirely.
    expect(source).toContain("row.term_end === row.term_start");
    expect(source).toContain("!row.counts_toward_cap");
  });

  it("is kept out of the holding list, so it can never fill a seat", () => {
    expect(source).toContain("markers.push(term)");
    expect(source).toContain("continue;");
  });
});

describe("the register cannot be read through a session client", () => {
  it("uses the admin client", () => {
    expect(source).toContain("createAdminClient");
    expect(source).not.toContain("createServerClient");
    expect(source).not.toContain("createBrowserClient");
  });

  it("says why, because the failure mode is silence", () => {
    const flat = source.replace(/\s*\n\s*\*\s*/g, " ");
    expect(flat).toContain("zero rows");
  });
});

describe("vacancies", () => {
  it("never goes negative when more people hold seats than the body has", () => {
    expect(source).toContain("Math.max(0, seatCount - holding.length)");
  });

  it("is null rather than zero when the body has no fixed size", () => {
    expect(source).toContain("seatCount === null ? null :");
  });
});
