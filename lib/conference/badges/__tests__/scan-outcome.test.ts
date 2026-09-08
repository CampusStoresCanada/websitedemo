import { describe, expect, it } from "vitest";
import { decideScanDirection } from "@/lib/conference/badges/scan";
import type { ScanClassificationPolicy } from "@/lib/conference/badges/scan";
import { DEFAULT_SCAN_DESTINATIONS } from "@/lib/conference/badges/rules";

/** What CSC ships with, and what the policy defaults to. */
const CSC: ScanClassificationPolicy = {
  disclosingOrgTypes: ["Vendor Partner", "Supplier"],
  attendeeOrgTypes: ["Member", "Non-Member", "Staff"],
  unlistedOrgTypeDiscloses: true,
};

/**
 * The rule that decides whether a scan sends someone's contact details to a
 * third party. Getting it wrong in the permissive direction shares an
 * attendee's details with a company they were never asked about, so it is
 * pinned here rather than discovered at a conference.
 */
describe("decideScanDirection", () => {
  it("reads a vendor scanning a member as company-to-attendee — the consent gate", () => {
    expect(
      decideScanDirection({ isSelf: false, scannerOrgType: "Vendor Partner", scannedOrgType: "Member", policy: CSC })
    ).toBe("companyToAttendee");
  });

  it("treats a configured Supplier as disclosing", () => {
    expect(
      decideScanDirection({ isSelf: false, scannerOrgType: "Supplier", scannedOrgType: "Member", policy: CSC })
    ).toBe("companyToAttendee");
  });

  it("reads a member scanning a vendor as attendee-to-company", () => {
    expect(
      decideScanDirection({ isSelf: false, scannerOrgType: "Member", scannedOrgType: "Vendor Partner", policy: CSC })
    ).toBe("attendeeToCompany");
  });

  it("reads a member scanning a member as attendee-to-attendee", () => {
    // Scanning a peer is a bid to connect with the person. Routing this to
    // /org/<slug> was the specific being flattened into the general.
    expect(
      decideScanDirection({ isSelf: false, scannerOrgType: "Member", scannedOrgType: "Member", policy: CSC })
    ).toBe("attendeeToAttendee");
  });

  it("reads a vendor scanning a vendor as company-to-company — the gate protects attendees", () => {
    expect(
      decideScanDirection({ isSelf: false, scannerOrgType: "Vendor Partner", scannedOrgType: "Vendor Partner", policy: CSC })
    ).toBe("companyToCompany");
  });

  it("self-scan wins over everything", () => {
    expect(
      decideScanDirection({ isSelf: true, scannerOrgType: "Vendor Partner", scannedOrgType: "Member", policy: CSC })
    ).toBe("self");
  });

  it("does not disclose when the scanner has no organisation at all", () => {
    // No org is not an unrecognised org — there is nobody to disclose TO.
    expect(
      decideScanDirection({ isSelf: false, scannerOrgType: null, scannedOrgType: "Member", policy: CSC })
    ).toBe("attendeeToAttendee");
  });

  // ── The configurable fallback ───────────────────────────────────────────
  //
  // An org type nobody has classified is the dangerous case, because it is
  // silent either way. Which way it goes is the admin's decision, not ours.

  it("ASKS for an unlisted org type when the fallback says to", () => {
    expect(
      decideScanDirection({
        isSelf: false,
        scannerOrgType: "Sponsor",
        scannedOrgType: "Member",
        policy: {
          disclosingOrgTypes: ["Vendor Partner"],
          attendeeOrgTypes: ["Member"],
          unlistedOrgTypeDiscloses: true,
        },
      })
    ).toBe("companyToAttendee");
  });

  it("stays internal for an unlisted org type when the fallback says so", () => {
    expect(
      decideScanDirection({
        isSelf: false,
        scannerOrgType: "Sponsor",
        scannedOrgType: "Member",
        policy: {
          disclosingOrgTypes: ["Vendor Partner"],
          attendeeOrgTypes: ["Member"],
          unlistedOrgTypeDiscloses: false,
        },
      })
    ).toBe("attendeeToAttendee");
  });

  it("catches a miscased org type via the fallback instead of silently not asking", () => {
    // `organizations.type` is capitalised. Previously a lowercase value fell
    // straight through to "internal" and nobody was ever asked. Now it lands on
    // the fallback, which defaults to asking — visible rather than silent.
    expect(
      decideScanDirection({ isSelf: false, scannerOrgType: "vendor partner", scannedOrgType: "Member", policy: CSC })
    ).toBe("companyToAttendee");
  });

  it("does NOT sweep a known attendee type into the fallback", () => {
    // The bug the two-list model exists to prevent: with one list, "Member" was
    // merely unlisted, so a permissive fallback made every member a discloser
    // and every peer scan raised a consent request for nothing.
    expect(
      decideScanDirection({ isSelf: false, scannerOrgType: "Member", scannedOrgType: "Member", policy: CSC })
    ).toBe("attendeeToAttendee");
  });

  it("maps a direction to whatever destination the CONFERENCE chose", () => {
    // The point of separating the two: a conference with no community sends
    // peer scans to the org page instead of a Circle profile that is not there.
    const noCommunity = {
      ...DEFAULT_SCAN_DESTINATIONS,
      attendeeToAttendee: "org" as const,
    };
    const direction = decideScanDirection({
      isSelf: false,
      scannerOrgType: "Member",
      scannedOrgType: "Member",
      policy: CSC,
    });
    expect(direction).toBe("attendeeToAttendee");
    expect(DEFAULT_SCAN_DESTINATIONS[direction]).toBe("circle");
    expect(noCommunity[direction]).toBe("org");
  });

  it("an empty disclosing list plus a permissive fallback asks about everyone", () => {
    // A conference that has configured nothing still protects its attendees.
    expect(
      decideScanDirection({
        isSelf: false,
        scannerOrgType: "Anything",
        scannedOrgType: "Member",
        policy: { disclosingOrgTypes: [], attendeeOrgTypes: [], unlistedOrgTypeDiscloses: true },
      })
    ).toBe("companyToAttendee");
  });
});
