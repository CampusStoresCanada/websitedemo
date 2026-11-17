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

/**
 * Offices.
 *
 * Steve, 2026-11-17: "between the AGM and the meeting there is a time where we
 * drop all the titles. The only thing that needs to be added is a reminder."
 *
 * So the correct behaviour in that window is NO officers — not last year's —
 * and the gap is closed by a person being reminded, not by the software
 * carrying a stale title forward.
 */
const actions = readFileSync("lib/actions/director-terms.ts", "utf8");
const tasks = readFileSync("lib/elections/action-items.ts", "utf8");

describe("an office is annual and lapses", () => {
  it("is written with an end date, defaulted to the next AGM", () => {
    const client = readFileSync("components/admin/board/BoardRegisterClient.tsx", "utf8");
    expect(client).toContain("useState(nextAgmDate ?? \"\")");
    expect(actions).toContain("heldUntil: string;");
  });

  it("refuses an end on or before the start", () => {
    const fn = actions.slice(actions.indexOf("export async function setBoardOffice"));
    expect(fn).toContain("input.heldUntil <= input.heldFrom");
  });

  it("⛔ ends the previous holder, so there are never two Treasurers", () => {
    const fn = actions.slice(actions.indexOf("export async function setBoardOffice"));
    expect(fn).toContain('.eq("role_key", input.office)');
    expect(fn).toContain("term_end: input.heldFrom");
  });

  it("⛔ an office never counts toward the four-term cap", () => {
    const fn = actions.slice(actions.indexOf("export async function setBoardOffice"));
    expect(fn).toContain("counts_toward_cap: false");
  });

  it("can lapse every open-ended office in one act", () => {
    const fn = actions.slice(actions.indexOf("export async function lapseBoardOffices"));
    expect(fn).toContain("term_end: input.on");
    expect(fn).toContain("OFFICE_KEYS");
  });

  it("the register reports offices only while they are held on the date asked", () => {
    expect(source).toContain("start <= input.asOf && (!end || end > input.asOf)");
  });
});

describe("the gap is closed by a reminder, not by a stale title", () => {
  it("the board is told to elect officers, as a dated obligation", () => {
    expect(tasks).toContain('key: "elect_officers"');
    expect(tasks).toContain("Elect the board's officers for {year}");
  });

  it("the reminder's owner is not an office that has just lapsed", () => {
    // president and past_president both lapse at the AGM; the Executive
    // Director is staff and does not.
    const t = tasks.slice(tasks.indexOf('key: "elect_officers"'));
    const owners = t.slice(t.indexOf("owners:"), t.indexOf("owners:") + 120);
    expect(owners).toContain("executive_director");
  });

  it("the title carries the year, or minting silently skips it", () => {
    // Deduped by title across every action item with no year scoping — nine
    // obligations were once skipped for exactly this reason.
    const t = tasks.slice(tasks.indexOf('key: "elect_officers"'));
    expect(t.slice(0, 200)).toContain("{year}");
  });
});

/**
 * ⛔ A `"use server"` file may export ONLY async functions.
 *
 * I exported a const array from `lib/actions/director-terms.ts`. `tsc --noEmit`
 * passed. `next build` passed. 3212 tests passed. The first page load threw
 * `A "use server" file can only export async functions, found object` and 500'd
 * the board register — and because the module never evaluated, the button I was
 * testing did nothing at all.
 *
 * CLAUDE.md warns about exactly this and says only loading a page catches it.
 * This catches it in the suite instead.
 */
describe("\"use server\" files export only async functions", () => {
  const serverActionFiles = [
    "lib/actions/director-terms.ts",
    "lib/actions/capability-appointments.ts",
    "lib/actions/site-content.ts",
  ];

  for (const file of serverActionFiles) {
    it(`${file} exports nothing but async functions and types`, () => {
      const src = readFileSync(file, "utf8");
      if (!/^\s*["']use server["']/m.test(src)) return;

      const offenders: string[] = [];
      for (const m of src.matchAll(/^export\s+(?!type\b|interface\b)(\w+)/gm)) {
        const kind = m[1];
        // `export async function` is the only runtime export permitted.
        if (kind === "async") continue;
        offenders.push(kind);
      }
      expect(offenders).toEqual([]);
    });
  }

  it("the office list therefore lives in a plain module", () => {
    const actions = readFileSync("lib/actions/director-terms.ts", "utf8");
    expect(actions).not.toContain("export const BOARD_OFFICES");
    expect(actions).toContain('from "@/lib/governance/register"');
    expect(source).toContain("export const OFFICE_KEYS");
  });

  it("and there is ONE list, not a mirror of one", () => {
    const actions = readFileSync("lib/actions/director-terms.ts", "utf8");
    const client = readFileSync("components/admin/board/BoardRegisterClient.tsx", "utf8");
    for (const f of [actions, client]) {
      expect(f).not.toMatch(/const\s+\w*OFFICE\w*\s*=\s*\[/);
      expect(f).not.toMatch(/vice_president:\s*"Vice President"/);
    }
  });
});
