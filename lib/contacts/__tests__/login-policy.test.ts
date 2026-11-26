import { describe, expect, it } from "vitest";
import { loginSkipReason } from "../login-policy";
import { circleAccessGroupForOrgType } from "../../circle/config";

describe("who may have a login", () => {
  it("an active member's contact, as before", () => {
    expect(loginSkipReason({ email: "a@b.ca", membershipStatus: "active" })).toBeNull();
    expect(loginSkipReason({ email: "a@b.ca", membershipStatus: null })).toBe("org_inactive");
  });

  it("a conference attendee whose school is not a member", () => {
    expect(loginSkipReason({ email: "a@b.ca", membershipStatus: null, conferenceAttendee: true })).toBeNull();
  });

  it("a seat does not override a person tagged non-member, or a missing email", () => {
    expect(loginSkipReason({ email: "a@b.ca", contactType: ["conference_only"], conferenceAttendee: true })).toBe("non_member_tag");
    expect(loginSkipReason({ email: " ", conferenceAttendee: true })).toBe("no_email");
  });
});

describe("the Circle access group a new login joins", () => {
  const groups = { member: 1, partner: 2 };
  it("members and partners get theirs", () => {
    expect(circleAccessGroupForOrgType("Member", groups)).toBe(1);
    expect(circleAccessGroupForOrgType("Vendor Partner", groups)).toBe(2);
  });
  it("a Non-Member organisation gets none, never CSC Members", () => {
    expect(circleAccessGroupForOrgType("Non-Member", groups)).toBeNull();
  });
});
