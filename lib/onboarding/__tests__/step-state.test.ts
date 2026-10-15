import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isStepOpen } from "../step-state";

const row = (over: Record<string, unknown> = {}) =>
  ({ id: "r", user_id: "u", persona: "member_member", step_key: "toolkit_tour",
     journey_started_at: null, sent_at: null, channel: null, completed_at: null,
     skipped_at: null, skip_reason: null, reminder_count: 0,
     last_reminder_sent_at: null, ...over }) as never;

describe("isStepOpen", () => {
  it("treats a missing row as open — the journey has not reached it yet", () => {
    expect(isStepOpen(null)).toBe(true);
    expect(isStepOpen(undefined)).toBe(true);
  });

  it("treats an untouched row as open", () => {
    expect(isStepOpen(row())).toBe(true);
  });

  it("closes a completed step", () => {
    expect(isStepOpen(row({ completed_at: "2026-10-15T00:00:00Z" }))).toBe(false);
  });

  it("closes a SKIPPED step — the case every call site used to miss", () => {
    expect(isStepOpen(row({ skipped_at: "2026-10-15T00:00:00Z" }))).toBe(false);
  });

  it("closes a step that is both", () => {
    expect(isStepOpen(row({ completed_at: "x", skipped_at: "y" }))).toBe(false);
  });
});

describe("no in-app surface decides step openness on its own", () => {
  const files = [
    "components/layout/OnboardingGate.tsx",
    "components/onboarding/OrgOnboardingCallout.tsx",
    "components/onboarding/DirectoryOnboardingCallout.tsx",
  ];
  it.each(files)("%s asks isStepOpen rather than reading completed_at inline", (f) => {
    const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    expect(src).toContain("isStepOpen");
    // the inline form this replaced — a step is never judged on completed_at alone
    expect(src).not.toMatch(/!result\.step\.completed_at/);
  });
});
