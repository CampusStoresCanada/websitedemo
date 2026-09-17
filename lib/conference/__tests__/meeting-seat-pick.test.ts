import { describe, expect, it } from "vitest";
import { pickMeetingSeat } from "../seats";
import type { SeatHolding } from "../seats";
import type { BuildEntity } from "@/lib/actions/conference-entities";

/**
 * Observed 2026-09-17 on a real account: a CSC staffer held BOTH a Staff
 * Registration and a Full Conference Registration. The agenda took the first
 * registration it was handed — the Staff one, which is `involved_in` no Meeting
 * Block — then asked the schedule for meetings on that seat. It correctly
 * returned none, so the page rendered a full programme and not one meeting.
 *
 * Nothing errored, nothing logged. The only way to notice was to already know
 * the person had meetings. That is the failure this picks apart.
 */
function entity(id: string, kind: string, refs: Array<{ role: string; to: string }> = []): BuildEntity {
  return {
    id, kind, name: id, conferenceId: "c1", attributes: {},
    refs: refs.map((r) => ({ role: r.role, toEntityId: r.to, quantity: null })),
  } as unknown as BuildEntity;
}

function seat(seatId: string, entityId: string): SeatHolding {
  return { seatId, entityId, entityKind: "registration", conferenceId: "c1", organizationId: "o1" } as SeatHolding;
}

/** staff-reg reaches nothing; full-reg is involved_in a meeting block. */
const byId = new Map<string, BuildEntity>([
  ["staff-reg", entity("staff-reg", "registration")],
  ["full-reg", entity("full-reg", "registration", [{ role: "involved_in", to: "block-1" }])],
  ["block-1", entity("block-1", "meeting")],
  ["booth-reg", entity("booth-reg", "registration", [{ role: "requires_ownership_of", to: "booth-7" }])],
  ["booth-7", entity("booth-7", "booth")],
]);

describe("picking the seat a person's meetings hang off", () => {
  it("takes the registration that is actually in the meetings, not the first one", () => {
    const picked = pickMeetingSeat([seat("s-staff", "staff-reg"), seat("s-full", "full-reg")], byId);
    expect(picked?.seatId).toBe("s-full");
  });

  it("is order-independent — the bug was that order decided it", () => {
    const picked = pickMeetingSeat([seat("s-full", "full-reg"), seat("s-staff", "staff-reg")], byId);
    expect(picked?.seatId).toBe("s-full");
  });

  it("falls back to the first registration when none is in the meetings", () => {
    // Exhibitor staff on a booth-only type, or CSC staff. Keep the old choice
    // rather than returning null and hiding the rest of their agenda.
    const picked = pickMeetingSeat([seat("s-staff", "staff-reg"), seat("s-booth", "booth-reg")], byId);
    expect(picked?.seatId).toBe("s-staff");
  });

  it("returns null when the person holds no registration at all", () => {
    expect(pickMeetingSeat([], byId)).toBeNull();
  });
});
