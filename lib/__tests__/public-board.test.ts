/**
 * /about reads the register, not nine hand-typed slots.
 *
 * The slots are where the governance register was originally backfilled FROM,
 * so the public page was the older source of truth and nothing synced them. A
 * director elected in January stayed off the page until somebody typed them in;
 * one who left stayed on it until somebody deleted them.
 *
 * These pin the decisions that are easy to get backwards, and the two ways this
 * is allowed to fail — both of them toward STALE, never toward wrong.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const data = readFileSync("lib/data.ts", "utf8");
const page = readFileSync("app/about/page.tsx", "utf8");
const fn = data.slice(data.indexOf("export async function getPublicBoard"));

describe("the page asks the register", () => {
  it("no longer reads the board slots directly", () => {
    expect(page).toContain("getPublicBoard()");
    expect(page).not.toContain('getSiteContent("board_of_directors")');
  });

  it("takes membership from who HOLDS a seat", () => {
    expect(fn).toContain("register.holding");
  });

  it("⛔ does NOT use the access window — access is not membership", () => {
    // An outgoing director keeps the mailing list through the conference and an
    // incoming one gets the board space early. Neither is on the board.
    expect(fn).not.toContain("hasBoardAccessOn");
    expect(fn).not.toContain("withAccessNotHolding");
  });

  it("derives the office title from the register, not the slot's subtitle", () => {
    expect(fn).toContain("officeFor.get(contactId) ?? \"Director\"");
    expect(fn).toContain("{ ...slot, subtitle: office }");
  });

  it("honours the term dates when deciding who holds an office", () => {
    expect(fn).toContain("if (start > asOf) continue;");
    expect(fn).toContain("if (end && end <= asOf) continue;");
  });
});

describe("it fails toward stale, never toward wrong", () => {
  it("falls back to the slots when the register reads empty", () => {
    // These three governance tables return zero rows through the wrong client
    // with no error at all, so an empty read is not evidence of an empty board.
    expect(fn).toContain("register.holding.length === 0) return slots");
  });

  it("⛔ falls back when the register is below the by-law floor", () => {
    // Four terms end on 2027-01-01. If the incoming four are not recorded yet
    // the register holds five against a minimum of seven, and rendering that
    // would tell the membership the board had halved overnight.
    expect(fn).toContain("register.belowMinimum");
    expect(fn).toContain("return slots;");
  });

  it("falls back on any error rather than rendering a blank board", () => {
    expect(fn).toContain("catch (err)");
    expect(fn).toContain("[getPublicBoard] falling back to site_content slots:");
  });

  it("keeps a slot that has no contact linked, rather than dropping it", () => {
    // Nothing can check it against the register, and deleting content nobody
    // can verify is the wrong direction to fail in.
    expect(fn).toContain("for (const s of slots) if (!s.contact_id) members.push(s);");
  });
});

describe("a director with no slot still renders", () => {
  it("fetches a contact card with the same join the slots use", () => {
    expect(fn).toContain("profile_picture_url");
    expect(fn).toContain("brand_colors(hex, sort_order)");
  });

  it("orders editorial slots first and the rest after", () => {
    expect(fn).toContain("display_order: 999");
    expect(fn).toContain("ao - bo ||");
  });
});
