import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MESSAGING_PRIORITY as P, mayTakeInbox } from "../priority";

describe("who gets the inbox today", () => {
  it("a free inbox takes anything", () => {
    expect(mayTakeInbox(P.onboarding, null).allowed).toBe(true);
  });

  it("onboarding yields to a lapse notice", () => {
    const v = mayTakeInbox(P.onboarding, P.lapse);
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("lapse date");
  });

  it("onboarding yields to a campaign", () => {
    expect(mayTakeInbox(P.onboarding, P.campaign).allowed).toBe(false);
  });

  it("a campaign yields to a deadline", () => {
    expect(mayTakeInbox(P.campaign, P.deadline).allowed).toBe(false);
  });

  it("a lapse notice still goes even if onboarding got there first", () => {
    // it cannot be un-sent, and burying a lapse notice is the worse outcome
    expect(mayTakeInbox(P.lapse, P.onboarding).allowed).toBe(true);
  });

  it("two of the same priority never both go", () => {
    expect(mayTakeInbox(P.event, P.event).allowed).toBe(false);
  });

  it("the ladder is in the order CSC set it", () => {
    expect(P.lapse).toBeLessThan(P.deadline);
    expect(P.deadline).toBeLessThan(P.event);
    expect(P.event).toBeLessThan(P.campaign);
    expect(P.campaign).toBeLessThan(P.onboarding);
  });
});

describe("system mail is off the ladder", () => {
  it("a null claim never blocks anybody", () => {
    expect(mayTakeInbox(P.onboarding, null).allowed).toBe(true);
  });

  it("the claim query excludes system mail", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/comms/contact-budget.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function inboxClaimsSince"));
    expect(fn).toContain('.not("priority", "is", null)');
  });
});

describe("priority is not encoded in cron times", () => {
  it("no test asserts a firing order — the dispatcher decides, not the clock", () => {
    // Deliberately empty of schedule assertions. Encoding the ladder in
    // vercel.json made priority invisible, spread it across eight entries, and
    // left it broken by anyone adding a sender or moving a time. One job now
    // picks the winner; when the crons fire stopped mattering.
    expect(true).toBe(true);
  });
});
