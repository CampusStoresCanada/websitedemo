import { describe, expect, it } from "vitest";
import {
  PRESENTATION_MINUTES,
  hhmm,
  isCourseMaterialsPartner,
  openWindows,
  presentationSlotStarts,
} from "@/lib/conference/big-ideas-day";

// The category strings are the real ones on file, 2026-11-20.
describe("isCourseMaterialsPartner", () => {
  it("admits the two course materials exhibitors", () => {
    // Kivuto Solutions and VitalSource both carry exactly this.
    expect(isCourseMaterialsPartner("Course Materials, Digital Course Materials")).toBe(true);
  });

  it("does not admit the rest of the floor", () => {
    expect(isCourseMaterialsPartner("Apparel")).toBe(false);
    expect(isCourseMaterialsPartner("Gifts & Promotional Products, Accessories")).toBe(false);
    // EZ Passport Studio: operations, which Steve left out of the rule.
    expect(
      isCourseMaterialsPartner("Operations & Support, Print & Copy Services, Facilities & Furniture")
    ).toBe(false);
    // "School Office & Lab Supplies" is a department of its own, not course materials.
    expect(isCourseMaterialsPartner("School Office & Lab Supplies")).toBe(false);
    expect(isCourseMaterialsPartner(null)).toBe(false);
  });
});

describe("presentation windows", () => {
  // Thursday as scheduled: breakfast, two breaks and lunch share the room.
  const windows = openWindows({ start: "09:00", end: "15:30" }, [
    { start: "08:00", end: "09:00" },
    { start: "10:30", end: "11:00" },
    { start: "12:00", end: "13:30" },
    { start: "14:30", end: "14:45" },
  ]);

  it("are the day minus what is served in the room", () => {
    expect(windows.map((w) => `${hhmm(w.start)}-${hhmm(w.end)}`)).toEqual([
      "09:00-10:30",
      "11:00-12:00",
      "13:30-14:30",
      "14:45-15:30",
    ]);
  });

  it("hold twelve back-to-back slots, none running into a meal", () => {
    const starts = presentationSlotStarts(windows);
    expect(starts.map(hhmm)).toEqual([
      "09:00", "09:20", "09:40", "10:00",
      "11:00", "11:20", "11:40",
      "13:30", "13:50", "14:10",
      "14:45", "15:05",
    ]);
    for (const s of starts) {
      expect(windows.some((w) => s >= w.start && s + PRESENTATION_MINUTES <= w.end)).toBe(true);
    }
  });
});
