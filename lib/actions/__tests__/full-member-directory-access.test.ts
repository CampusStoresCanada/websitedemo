import { describe, it, expect } from "vitest";
import { hasPermission } from "@/lib/auth/permissions";
import type { PermissionState } from "@/lib/auth/types";

/**
 * Who sees "Full Member Directory CSV" in Toolkit → Export on /members.
 *
 * The partner branch was gated on `hasPermission(partner) && !hasPermission(member)`
 * — "exactly a partner". CSC staff outrank that on the permission ladder, so an
 * admin fell through to the else and got only the plain store list. The one
 * export partners ask for was the one export staff could not pull, could not
 * verify, and could not send on request.
 */
const seesPartnerExports = (p: PermissionState) =>
  hasPermission(p, "partner") && !hasPermission(p, "member");
const seesFullDirectory = (p: PermissionState) =>
  seesPartnerExports(p) || hasPermission(p, "admin");

describe("Full Member Directory CSV visibility", () => {
  it("a partner sees it — this is the thing they pay for", () => {
    expect(seesFullDirectory("partner")).toBe(true);
  });

  it("CSC staff see it — the regression this test exists for", () => {
    expect(seesFullDirectory("admin")).toBe(true);
    expect(seesFullDirectory("super_admin")).toBe(true);
  });

  it("staff are NOT treated as partners — 'My Buyer Contacts' needs a category they don't have", () => {
    expect(seesPartnerExports("admin")).toBe(false);
    expect(seesPartnerExports("super_admin")).toBe(false);
  });

  it("a member store does not get the partner member-contact export", () => {
    expect(seesFullDirectory("member")).toBe(false);
    expect(seesFullDirectory("org_admin")).toBe(false);
  });

  it("the public does not", () => {
    expect(seesFullDirectory("public")).toBe(false);
  });
});
