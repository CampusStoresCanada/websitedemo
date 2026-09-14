/**
 * The date preview must never become a way to act early.
 *
 * Its whole risk is that moving the calendar past a deadline makes the timeline
 * compute an UNBLOCKED action — a live "Close nominations" button eight weeks
 * before the published close. disableActions is the thing standing between a
 * viewing tool and a repeat of the send that went out by one press.
 */
import { describe, it, expect } from "vitest";
import { asOfDate, disableActions, DATE_PREVIEW_BLOCK } from "../preview";

describe("asOfDate", () => {
  it("accepts a real date", () => {
    expect(asOfDate({ asOf: "2026-10-23" })).toBe("2026-10-23");
  });

  it("rejects anything that is not one", () => {
    for (const bad of ["", "today", "2026-13-40", "2026-02-30", "2026-1-1", "'; drop--"]) {
      expect(asOfDate({ asOf: bad })).toBeNull();
    }
    expect(asOfDate(undefined)).toBeNull();
  });
});

describe("disableActions", () => {
  it("blocks an action the moved calendar had unblocked", () => {
    const stages = [
      { key: "nominations_close", action: { key: "closeNominations", label: "Close nominations", blockedBy: null } },
    ];
    expect(disableActions(stages)[0].action?.blockedBy).toBe(DATE_PREVIEW_BLOCK);
  });

  it("leaves stages with no action alone", () => {
    expect(disableActions([{ key: "cycle_open", action: null }])[0].action).toBeNull();
  });

  it("blocks every action, not just the first", () => {
    const stages = [
      { key: "a", action: { key: "sendCall", label: "Send the call", blockedBy: null } },
      { key: "b", action: { key: "sealElection", label: "Seal", blockedBy: null } },
      { key: "c", action: { key: "announceResults", label: "Announce", blockedBy: null } },
    ];
    for (const stage of disableActions(stages)) {
      expect(stage.action?.blockedBy).toBe(DATE_PREVIEW_BLOCK);
    }
  });
});
