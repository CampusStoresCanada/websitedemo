import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isBusinessDay, nationalHolidays } from "@/lib/board/vote-schedule";

describe("onboarding mail lands on a working day", () => {
  it("the job returns before sending anything on a non-working day", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/onboarding/nudge-job.ts"), "utf8");
    expect(src).toContain("isBusinessDay");
    // the guard must come before the pending-rows fetch, or it has already done work
    const guard = src.indexOf("not a working day");
    const fetch = src.indexOf("Find all pending progress rows");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fetch);
  });

  it("reuses the board scheduler rather than reimplementing holidays", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "lib/onboarding/nudge-job.ts"), "utf8");
    expect(src).toContain('from "@/lib/board/vote-schedule"');
    expect(src).not.toMatch(/const\s+(HOLIDAYS|NATIONAL_HOLIDAYS)\s*=/);
  });

  it("agrees with the shared calendar on weekends and Christmas", () => {
    expect(isBusinessDay(2026, 10, 16)).toBe(true);   // Friday
    expect(isBusinessDay(2026, 10, 17)).toBe(false);  // Saturday
    expect(isBusinessDay(2026, 10, 18)).toBe(false);  // Sunday
    expect(isBusinessDay(2026, 10, 19)).toBe(true);   // Monday
    expect(isBusinessDay(2026, 12, 25)).toBe(false);  // Christmas Day
  });

  it("knows the statutory holidays the board calendar knows", () => {
    const h = nationalHolidays(2026);
    expect(h.size).toBeGreaterThan(0);
    expect([...h].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });
});
