import { describe, expect, it } from "vitest";
import { conferenceDeskPathId, isCheckInDeskPath, isEmbedded, isWarRoomPath } from "../nav";

/**
 * ⛔ The /admin gate admits desk staff on this answer, then checks their
 * appointment for the conference it returns. It must open exactly the desk and
 * war room — staff operate a conference, they do not design it — and name the
 * right conference.
 */
describe("conferenceDeskPathId", () => {
  it("returns the conference for the desk", () => {
    expect(conferenceDeskPathId("/admin/conference/abc-123/check-in")).toBe("abc-123");
  });

  it("covers deeper paths under the desk (its printed sheets)", () => {
    expect(conferenceDeskPathId("/admin/conference/abc-123/check-in/door-list")).toBe("abc-123");
  });

  it("keeps the War Room and design pages shut to desk staff", () => {
    for (const segment of ["war-room", "badges", "schedule-ops", "details", "build", "registrations", "legal", "overview"]) {
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

describe("isWarRoomPath", () => {
  it("gives the War Room its own header, without the Manage sidebar or tabs", () => {
    expect(isWarRoomPath("/admin/conference/abc-123/war-room")).toBe(true);
    expect(isWarRoomPath("/admin/conference/abc-123/war-room/")).toBe(true);
    expect(isWarRoomPath("/admin/conference/abc-123/war-roomy")).toBe(false);
    expect(isWarRoomPath("/admin/conference/abc-123/check-in")).toBe(false);
  });
});

describe("isEmbedded", () => {
  it("is only an explicit embed=1, how a print sheet shows inside a Preview", () => {
    expect(isEmbedded("?embed=1")).toBe(true);
    expect(isEmbedded("?entity=e1&embed=1")).toBe(true);
    expect(isEmbedded("?embed=0")).toBe(false);
    expect(isEmbedded("")).toBe(false);
  });
});
