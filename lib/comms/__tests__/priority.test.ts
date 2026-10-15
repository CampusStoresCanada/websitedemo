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

describe("the crons run in ladder order, so arbitration is not decided by accident", () => {
  const crons = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")).crons as
    { path: string; schedule: string }[];
  const at = (p: string) => {
    const c = crons.find((c) => c.path === p)!;
    const [m, h] = c.schedule.split(" ");
    return Number(h) * 60 + Number(m);
  };

  it("renewals (lapse) run before the conference checklist (deadline)", () => {
    expect(at("/api/cron/renewal-reminders")).toBeLessThan(at("/api/cron/checklist-reminders"));
  });

  it("deadlines run before events", () => {
    expect(at("/api/cron/checklist-reminders")).toBeLessThan(at("/api/cron/rfp-notifications"));
  });

  it("onboarding runs last of all of them", () => {
    const others = [
      "/api/cron/renewal-reminders",
      "/api/cron/checklist-reminders",
      "/api/cron/elections-kickoff",
      "/api/cron/action-item-reminders",
      "/api/cron/rfp-notifications",
      "/api/cron/prospective-booth-followup",
    ].map(at);
    expect(at("/api/cron/onboarding-nudge")).toBeGreaterThan(Math.max(...others));
  });
});
