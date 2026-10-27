import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadMeetingConfirmations } from "../schedule-ops";

type Row = {
  schedule_id: string;
  confirmed_by: "attendee" | "exhibitor" | "staff";
  person_id: string;
  ruling: string | null;
  ruling_note: string | null;
};

/** Rows come back in the order given, as the real query orders them by time. */
function fakeDb(rows: Row[]) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => query } as unknown as Parameters<typeof loadMeetingConfirmations>[0];
}

const scan = (person: string, by: "attendee" | "exhibitor" = "attendee"): Row => ({
  schedule_id: "m1",
  confirmed_by: by,
  person_id: person,
  ruling: null,
  ruling_note: null,
});
const ruling = (person: string, value: string, note: string | null = null): Row => ({
  schedule_id: "m1",
  confirmed_by: "staff",
  person_id: person,
  ruling: value,
  ruling_note: note,
});

describe("loadMeetingConfirmations", () => {
  it("counts a scan as attended", async () => {
    const out = await loadMeetingConfirmations(fakeDb([scan("p1")]), ["m1"]);
    expect(out.get("m1")?.confirmedPersonIds).toEqual(["p1"]);
    expect(out.get("m1")?.byAttendee).toBe(true);
  });

  it("lets a staff ruling of absent override a scan", async () => {
    const out = await loadMeetingConfirmations(fakeDb([scan("p1"), ruling("p1", "absent")]), ["m1"]);
    expect(out.get("m1")?.confirmedPersonIds).toEqual([]);
    // What the scans said stays visible.
    expect(out.get("m1")?.byAttendee).toBe(true);
  });

  it("records excused with its note, and excused is not attended", async () => {
    const out = await loadMeetingConfirmations(fakeDb([ruling("p1", "excused", "partner did not show")]), ["m1"]);
    expect(out.get("m1")?.confirmedPersonIds).toEqual([]);
    expect(out.get("m1")?.rulings.p1).toEqual({ ruling: "excused", note: "partner did not show" });
  });

  it("counts a delegate staff ruled attended without a scan", async () => {
    const out = await loadMeetingConfirmations(fakeDb([ruling("p1", "attended")]), ["m1"]);
    expect(out.get("m1")?.confirmedPersonIds).toEqual(["p1"]);
    expect(out.get("m1")?.byAttendee).toBe(false);
  });

  it("takes the newest ruling", async () => {
    const out = await loadMeetingConfirmations(fakeDb([ruling("p1", "absent"), ruling("p1", "attended")]), ["m1"]);
    expect(out.get("m1")?.confirmedPersonIds).toEqual(["p1"]);
    expect(out.get("m1")?.rulings.p1.ruling).toBe("attended");
  });

  it("rules on one delegate without touching another", async () => {
    const out = await loadMeetingConfirmations(fakeDb([scan("p1"), scan("p2"), ruling("p2", "absent")]), ["m1"]);
    expect(out.get("m1")?.confirmedPersonIds).toEqual(["p1"]);
  });
});
