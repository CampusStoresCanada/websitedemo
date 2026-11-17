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

/**
 * The access window.
 *
 * Steve, 2026-11-17: *"we don't cut off Shawn on January 1 either."* A term and
 * a door are different facts, and conflating them is wrong at BOTH ends of every
 * cycle — the incoming director invited in the autumn, and the outgoing one who
 * stays through the conference after the AGM.
 */
import { hasBoardAccessOn, accessStandingOn } from "../register";

const win = (
  termStart: string,
  termEnd: string | null,
  accessFrom: string | null = null,
  accessUntil: string | null = null,
  isNoServiceMarker = false
) => ({ termStart, termEnd, accessFrom, accessUntil, isNoServiceMarker });

describe("access defaults to the term when nothing is set", () => {
  it("behaves exactly like holdsOn for a row written before these columns existed", () => {
    const t = win("2025-01-01", "2027-01-01");
    for (const d of ["2024-12-31", "2025-01-01", "2026-12-31", "2027-01-01"]) {
      expect(hasBoardAccessOn(t, d)).toBe(holdsOn(t, d));
    }
  });

  it("grants nothing for a no-prior-service marker, whatever the access dates say", () => {
    const t = win("2026-09-28", "2026-09-28", "2020-01-01", "2030-01-01", true);
    expect(hasBoardAccessOn(t, "2026-09-28")).toBe(false);
    expect(accessStandingOn(t, "2026-09-28")).toBe("none");
  });
});

describe("incoming — let in before the term starts", () => {
  // Jackie Nguyen: acclaimed in October, term 2027-01-01, invited in November.
  const jackie = win("2027-01-01", "2029-01-01", "2026-11-17", null);

  it("has access the day the window opens", () => {
    expect(hasBoardAccessOn(jackie, "2026-11-17")).toBe(true);
  });

  it("has none the day before it", () => {
    expect(hasBoardAccessOn(jackie, "2026-11-16")).toBe(false);
  });

  it("⛔ does NOT hold the seat — she is not a director yet", () => {
    expect(holdsOn(jackie, "2026-11-17")).toBe(false);
    expect(holdsOn(jackie, "2026-12-31")).toBe(false);
  });

  it("reads as incoming while access precedes the term", () => {
    expect(accessStandingOn(jackie, "2026-11-17")).toBe("incoming");
  });

  it("becomes holding once the term starts, not before", () => {
    expect(accessStandingOn(jackie, "2026-12-31")).toBe("incoming");
    expect(accessStandingOn(jackie, "2027-01-01")).toBe("holding");
  });
});

describe("outgoing — kept on after the term ends", () => {
  // Shawn Davies: term ends 2027-01-01, stays through the conference.
  const shawn = win("2025-01-01", "2027-01-01", null, "2027-06-30");

  it("keeps access after the term has ended", () => {
    expect(holdsOn(shawn, "2027-01-01")).toBe(false);
    expect(hasBoardAccessOn(shawn, "2027-01-01")).toBe(true);
  });

  it("reads as outgoing in the gap", () => {
    expect(accessStandingOn(shawn, "2027-01-01")).toBe("outgoing");
    expect(accessStandingOn(shawn, "2027-06-29")).toBe("outgoing");
  });

  it("access_until is EXCLUSIVE, like every other date here", () => {
    expect(hasBoardAccessOn(shawn, "2027-06-29")).toBe(true);
    expect(hasBoardAccessOn(shawn, "2027-06-30")).toBe(false);
    expect(accessStandingOn(shawn, "2027-06-30")).toBe("none");
  });

  it("still holds the seat while the term runs", () => {
    expect(accessStandingOn(shawn, "2026-12-31")).toBe("holding");
  });
});

describe("the mailing list asks the access question, not the seat question", () => {
  it("the group sync filters on hasBoardAccessOn", () => {
    const sync = readFileSync("lib/google/governance-group.ts", "utf8");
    expect(sync).toContain("hasBoardAccessOn");
    expect(sync).not.toContain("holdsOn(");
  });

  it("stopped expressing the window as a second hand-written query filter", () => {
    const sync = readFileSync("lib/google/governance-group.ts", "utf8");
    expect(sync).not.toContain('.lte("term_start", asOf)');
  });
});
