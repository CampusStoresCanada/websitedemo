import { describe, expect, it } from "vitest";
import { isConferenceOpsPath } from "../nav";

/**
 * ⛔ The /admin gate admits conference ops staff on this answer alone, so it
 * must open exactly the desk, war room, badge and schedule-ops pages and
 * nothing that merely looks like them.
 */
describe("isConferenceOpsPath", () => {
  it("opens the four conference ops pages", () => {
    for (const segment of ["check-in", "war-room", "badges", "schedule-ops"]) {
      expect(isConferenceOpsPath(`/admin/conference/abc-123/${segment}`)).toBe(true);
    }
  });

  it("opens deeper paths under an ops page", () => {
    expect(isConferenceOpsPath("/admin/conference/abc-123/badges/jobs")).toBe(true);
  });

  it("keeps every other conference page shut", () => {
    for (const segment of ["details", "build", "registrations", "comms", "legal", "overview"]) {
      expect(isConferenceOpsPath(`/admin/conference/abc-123/${segment}`)).toBe(false);
    }
    expect(isConferenceOpsPath("/admin/conference/abc-123")).toBe(false);
    expect(isConferenceOpsPath("/admin/conference")).toBe(false);
  });

  it("does not match a segment that only starts like an ops page", () => {
    expect(isConferenceOpsPath("/admin/conference/abc-123/check-in-settings")).toBe(false);
    expect(isConferenceOpsPath("/admin/conference/abc-123/badges-admin")).toBe(false);
  });

  it("keeps the rest of /admin shut", () => {
    expect(isConferenceOpsPath("/admin/members")).toBe(false);
    expect(isConferenceOpsPath("/admin/check-in")).toBe(false);
    expect(isConferenceOpsPath("")).toBe(false);
  });
});
