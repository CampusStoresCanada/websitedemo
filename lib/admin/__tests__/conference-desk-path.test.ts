import { describe, expect, it } from "vitest";
import { conferenceDeskPathId, isCheckInDeskPath } from "../nav";

/**
 * ⛔ The /admin gate admits desk staff on this answer, then checks their
 * appointment for the conference it returns. It must open exactly the desk and
 * war room — staff operate a conference, they do not design it — and name the
 * right conference.
 */
describe("conferenceDeskPathId", () => {
  it("returns the conference for the desk and war room", () => {
    expect(conferenceDeskPathId("/admin/conference/abc-123/check-in")).toBe("abc-123");
    expect(conferenceDeskPathId("/admin/conference/abc-123/war-room")).toBe("abc-123");
  });

  it("covers deeper paths under a desk page", () => {
    expect(conferenceDeskPathId("/admin/conference/abc-123/war-room/anything")).toBe("abc-123");
  });

  it("keeps design pages shut, badges and schedule ops included", () => {
    for (const segment of ["badges", "schedule-ops", "details", "build", "registrations", "legal", "overview"]) {
      expect(conferenceDeskPathId(`/admin/conference/abc-123/${segment}`)).toBeNull();
    }
    expect(conferenceDeskPathId("/admin/conference/abc-123")).toBeNull();
    expect(conferenceDeskPathId("/admin/conference")).toBeNull();
  });

  it("does not match a segment that only starts like a desk page", () => {
    expect(conferenceDeskPathId("/admin/conference/abc-123/check-in-settings")).toBeNull();
  });

  it("keeps the rest of /admin shut", () => {
    expect(conferenceDeskPathId("/admin/members")).toBeNull();
    expect(conferenceDeskPathId("/admin/check-in")).toBeNull();
    expect(conferenceDeskPathId("")).toBeNull();
  });
});

describe("isCheckInDeskPath", () => {
  it("frames nothing around the desk or the door's printed list", () => {
    expect(isCheckInDeskPath("/admin/conference/abc-123/check-in")).toBe(true);
    expect(isCheckInDeskPath("/admin/conference/abc-123/check-in/door-list")).toBe(true);
  });

  it("leaves every other page framed", () => {
    expect(isCheckInDeskPath("/admin/conference/abc-123/war-room")).toBe(false);
    expect(isCheckInDeskPath("/admin/conference/abc-123/check-in/anything-else")).toBe(false);
  });
});
