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
        exhibitorRegistrationId: "e2",
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
        exhibitorRegistrationId: "e1",
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
        exhibitorRegistrationId: "e3",
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

  it("builds why-lower text from score component deltas", () => {
    const why = buildWhyLowerReasons(
      {
        category_overlap: 30,
        buying_timeline_match: 20,
        priority_alignment: 18,
        top_5_preference: 15,
        meeting_intent_match: 10,
        purchasing_authority: 5,
        blackout_penalty: 0,
      },
      {
        category_overlap: 20,
        buying_timeline_match: 20,
        priority_alignment: 11,
        top_5_preference: 0,
        meeting_intent_match: 10,
        purchasing_authority: 3,
        blackout_penalty: 0,
      }
    );

    expect(why).toContain("category overlap is lower (20 vs 30)");
    expect(why).toContain("priority alignment is lower (11 vs 18)");
    expect(why).toContain("top 5 preference is lower (0 vs 15)");
    expect(why).toContain("purchasing authority fit is lower (3 vs 5)");
  });

  it("flags conflicts for delegate and linked registrations in same slot", () => {
    const delegateSlots = new Set(["slot-1", "slot-2"]);
    const linkedSlots = new Set(["slot-4"]);

    expect(hasLinkedSlotConflict("slot-2", delegateSlots, linkedSlots)).toBe(true);
    expect(hasLinkedSlotConflict("slot-4", delegateSlots, linkedSlots)).toBe(true);
    expect(hasLinkedSlotConflict("slot-5", delegateSlots, linkedSlots)).toBe(false);
  });
});
