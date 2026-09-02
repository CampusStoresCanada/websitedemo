import { describe, expect, it } from "vitest";
import {
  buildWhyLowerReasons,
  countConsumedSwaps,
  hasLinkedSlotConflict,
  isTwoWayBlackout,
  rankSwapAlternatives,
} from "../swaps";

describe("scheduler swaps helpers", () => {
  it("enforces two-way blackout checks", () => {
    expect(
      isTwoWayBlackout("delegate-org", ["x-org"], "x-org", [])
    ).toBe(true);
    expect(
      isTwoWayBlackout("delegate-org", [], "x-org", ["delegate-org"])
    ).toBe(true);
    expect(
      isTwoWayBlackout("delegate-org", [], "x-org", [])
    ).toBe(false);
  });

  it("counts requested mode with denied-cap excluded", () => {
    const rows = [
      { status: "requested" },
      { status: "options_generated" },
      { status: "approved_committed" },
      { status: "denied_invalid" },
      { status: "denied_cap_reached" },
    ];

    expect(countConsumedSwaps(rows, "requested")).toBe(4);
  });

  it("counts committed mode only on approved commits", () => {
    const rows = [
      { status: "requested" },
      { status: "options_generated" },
      { status: "approved_committed" },
      { status: "denied_invalid" },
      { status: "approved_committed" },
    ];

    expect(countConsumedSwaps(rows, "committed")).toBe(2);
  });

  it("ranks alternatives by score first, then deterministic tie-break", () => {
    const ranked = rankSwapAlternatives([
      {
        scheduleId: "b",
        exhibitorSeatId: "e2",
        exhibitorOrganizationId: "org2",
        score: 80,
        scoreDeltaFromOriginal: -5,
        scoreBreakdown: {
          category_overlap: 10,
          buying_timeline_match: 10,
          priority_alignment: 10,
          top_5_preference: 0,
          meeting_intent_match: 5,
          purchasing_authority: 5,
          blackout_penalty: 0,
        },
        reasons: [],
        whyLower: [],
      },
      {
        scheduleId: "a",
        exhibitorSeatId: "e1",
        exhibitorOrganizationId: "org1",
        score: 80,
        scoreDeltaFromOriginal: -5,
        scoreBreakdown: {
          category_overlap: 10,
          buying_timeline_match: 10,
          priority_alignment: 10,
          top_5_preference: 0,
          meeting_intent_match: 5,
          purchasing_authority: 5,
          blackout_penalty: 0,
        },
        reasons: [],
        whyLower: [],
      },
      {
        scheduleId: "c",
        exhibitorSeatId: "e3",
        exhibitorOrganizationId: "org3",
        score: 88,
        scoreDeltaFromOriginal: -2,
        scoreBreakdown: {
          category_overlap: 12,
          buying_timeline_match: 12,
          priority_alignment: 12,
          top_5_preference: 0,
          meeting_intent_match: 6,
          purchasing_authority: 5,
          blackout_penalty: 0,
        },
        reasons: [],
        whyLower: [],
      },
    ]);

    expect(ranked.map((item) => item.scheduleId)).toEqual(["c", "a", "b"]);
  });

  it("builds why-lower text from the engine's axes", () => {
    const why = buildWhyLowerReasons(
      { category: 0.9, province: 0.5, certification: 0.4, timing: 0.2 },
      { category: 0.6, province: 0.5, certification: 0.1, timing: 0.2 }
    );

    expect(why).toContain("category overlap is lower (0.6 vs 0.9)");
    expect(why).toContain("certification fit is lower (0.1 vs 0.4)");
    // Equal axes say nothing.
    expect(why.join(" ")).not.toContain("province");
    expect(why.join(" ")).not.toContain("timing");
  });

  it("⛔ says nothing about an axis that was never observed", () => {
    /**
     * null means the axis had NOTHING TO SAY about that pair; 0 means it looked
     * and found no fit. The old code read `Number(value ?? 0)`, so an unobserved
     * axis was reported as "province fit is lower (0 vs 0.4)" — a judgement
     * nobody made, shown to a member deciding whether to give up a meeting.
     */
    const why = buildWhyLowerReasons(
      { category: 0.9, province: 0.4 },
      { category: 0.9, province: null }
    );
    expect(why).toEqual([]);

    // ...and the same in the other direction.
    expect(
      buildWhyLowerReasons({ province: null }, { province: 0.1 })
    ).toEqual([]);
  });

  it("falls back to the raw axis name for an axis it has no label for", () => {
    // The engine's axes will change as signals light up; an unknown key must
    // still produce a sentence rather than disappearing.
    const why = buildWhyLowerReasons({ some_new_axis: 0.8 }, { some_new_axis: 0.2 });
    expect(why).toEqual(["some_new_axis is lower (0.2 vs 0.8)"]);
  });

  it("flags conflicts for delegate and linked registrations in same slot", () => {
    const delegateSlots = new Set(["slot-1", "slot-2"]);
    const linkedSlots = new Set(["slot-4"]);

    expect(hasLinkedSlotConflict("slot-2", delegateSlots, linkedSlots)).toBe(true);
    expect(hasLinkedSlotConflict("slot-4", delegateSlots, linkedSlots)).toBe(true);
    expect(hasLinkedSlotConflict("slot-5", delegateSlots, linkedSlots)).toBe(false);
  });
});
