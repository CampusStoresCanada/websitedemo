import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mayNudge, NUDGE_QUIET_HOURS, MAX_EMAILS_PER_PERSON_PER_DAY } from "../contact-budget";

const now = new Date("2026-10-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 36e5).toISOString();

describe("one person, one day", () => {
  it("lets a nudge through when they have not heard from us", () => {
    expect(mayNudge({ lastContactedAt: null, sentInLastDay: 0, now }).allowed).toBe(true);
  });

  it("holds a nudge when something else reached them this morning", () => {
    const v = mayNudge({ lastContactedAt: hoursAgo(3), sentInLastDay: 1, now });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/heard from us/);
  });

  it("holds it at the daily cap even if the last one was a while back", () => {
    const v = mayNudge({ lastContactedAt: hoursAgo(30), sentInLastDay: MAX_EMAILS_PER_PERSON_PER_DAY, now });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/already had/);
  });

  it("lets it through once the quiet window has passed", () => {
    expect(mayNudge({ lastContactedAt: hoursAgo(NUDGE_QUIET_HOURS + 1), sentInLastDay: 0, now }).allowed).toBe(true);
  });

  it("the five-in-a-day case is refused", () => {
    expect(mayNudge({ lastContactedAt: hoursAgo(1), sentInLastDay: 5, now }).allowed).toBe(false);
  });
});

describe("the ledger is written where every sender passes", () => {
  const send = fs.readFileSync(path.join(process.cwd(), "lib/email/send.ts"), "utf8");

  it("records from lib/email/send.ts, not from the call sites", () => {
    expect(send).toContain("recordSends");
  });

  it("records the intended recipient, never the dev intercept address", () => {
    // the intended recipient, not the `to` that DEV_EMAIL_INTERCEPT rewrites
    expect(send).toMatch(/recordSends\(\[options\.to\]/);
    expect(send).not.toMatch(/recordSends\(\[\s*to\s*[,\]]/);
  });

  it("never lets a logging failure stop the mail", () => {
    const fn = send.slice(send.indexOf("async function recordSends"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toContain("catch");
  });
});

describe("the nudge job refuses to send when it cannot read the ledger", () => {
  it("returns rather than treating an error as 'nobody has heard from us'", () => {
    const job = fs.readFileSync(path.join(process.cwd(), "lib/onboarding/nudge-job.ts"), "utf8");
    expect(job).toContain("contact budget unavailable, sending nothing this run");
  });
});
