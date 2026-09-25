// A checklist that can never reach anyone, and looks fine from every screen.
//
// Reminders fire at checkpoints, and a checkpoint is days before the
// CHECKLIST's deadline — never the task's. Measured on CSC 2027 (2026-09-24):
// two of the three active checklists had no checkpoints at all, so they sent
// nothing, ever. And the Hot Products Care Package hardens 20 November while
// the Exhibitor checklist's first reminder goes out 27 November — put it there
// and it is first mentioned a week after it was already too late.
//
// Neither state throws, logs, or shows anywhere. That is what this catches.

import { describe, it, expect, vi, beforeEach } from "vitest";

type Checklist = {
  id: string; name: string; deadline_at: string; conference_id: string;
  conference_checklist_checkpoints: Array<{ days_before_deadline: number }>;
  conference_checklist_tasks: Array<{ name: string; deadline_at: string | null; active: boolean }>;
};

let CHECKLISTS: Checklist[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: async () => ({ data: CHECKLISTS, error: null }),
      };
      return chain;
    },
  }),
}));

const { evaluateChecklistReachability } = await import("../alerts");

function checklist(over: Partial<Checklist> = {}): Checklist {
  return {
    id: "cl-1", name: "Exhibitor", deadline_at: "2027-01-11", conference_id: "c1",
    conference_checklist_checkpoints: [{ days_before_deadline: 45 }, { days_before_deadline: 7 }],
    conference_checklist_tasks: [{ name: "Pay", deadline_at: "2027-01-04", active: true }],
    ...over,
  };
}

describe("a checklist nobody will ever hear from", () => {
  beforeEach(() => { CHECKLISTS = []; });

  it("is quiet when reminders land before everything hardens", async () => {
    CHECKLISTS = [checklist()];
    expect(await evaluateChecklistReachability()).toEqual([]);
  });

  it("flags an active checklist with tasks and no checkpoints", async () => {
    // Two of three active checklists were in exactly this state.
    CHECKLISTS = [checklist({ conference_checklist_checkpoints: [] })];
    const [alert] = await evaluateChecklistReachability();
    expect(alert.details).toMatchObject({ reason: "no_checkpoints" });
  });

  it("does NOT flag an empty checklist — nothing to remind about is not a fault", async () => {
    CHECKLISTS = [checklist({ conference_checklist_checkpoints: [], conference_checklist_tasks: [] })];
    expect(await evaluateChecklistReachability()).toEqual([]);
  });

  it("flags a task that hardens before the first reminder goes out", async () => {
    // The care package: 20 Nov, against a first reminder of 27 Nov.
    CHECKLISTS = [checklist({
      conference_checklist_tasks: [
        { name: "Ship your Hot Products Care Package", deadline_at: "2026-11-20", active: true },
      ],
    })];
    const [alert] = await evaluateChecklistReachability();
    expect(alert.details).toMatchObject({
      reason: "task_hardens_before_first_reminder",
      firstReminderAt: "2026-11-27",
    });
  });

  it("measures from the WIDEST checkpoint, not the nearest one", async () => {
    // 45 days back is the first reminder; reading 7 would call everything late.
    CHECKLISTS = [checklist({
      conference_checklist_tasks: [{ name: "Pay", deadline_at: "2026-12-01", active: true }],
    })];
    expect(await evaluateChecklistReachability()).toEqual([]);
  });

  it("ignores inactive tasks and undated ones", async () => {
    CHECKLISTS = [checklist({
      conference_checklist_tasks: [
        { name: "Retired", deadline_at: "2026-01-01", active: false },
        { name: "Undated", deadline_at: null, active: true },
      ],
    })];
    expect(await evaluateChecklistReachability()).toEqual([]);
  });

  it("keys per checklist, so a second one breaking is still reported", async () => {
    CHECKLISTS = [
      checklist({ id: "cl-a", conference_checklist_checkpoints: [] }),
      checklist({ id: "cl-b", name: "Your Conference", conference_checklist_checkpoints: [] }),
    ];
    const keys = (await evaluateChecklistReachability()).map((a) => a.ruleKey);
    expect(keys).toEqual(["checklist_unreachable:cl-a", "checklist_unreachable:cl-b"]);
  });
});
