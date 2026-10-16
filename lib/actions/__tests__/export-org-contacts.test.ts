import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The toolkit's Contacts CSV used to read `contacts` through the caller's own
 * session client. That table's only surviving SELECT policy is "your own org",
 * so on anyone else's org page RLS filtered every row away and returned
 * `error: null` — the button downloaded a header-only file with no explanation,
 * while the page next to it rendered those same contacts in full.
 *
 * The export now reads through getOrganizationForViewer, the same reader the
 * org page uses, so the file and the screen can't disagree.
 */

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  contacts: [] as Record<string, unknown>[],
  organization: { id: "o1", name: "University of Example" } as { id: string; name: string } | null,
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "u1", supabase: {} } }),
}));

vi.mock("@/lib/visibility/viewer", () => ({
  getOrgPageViewerContext: async () => ({
    viewer: { viewerLevel: "partner", viewerOrgIds: [], viewerOrgAdminIds: [] },
    effectiveViewer: { viewerLevel: "partner", viewerOrgIds: [], viewerOrgAdminIds: [] },
    org: { id: "o1", membership_status: "active", public_code: null },
    orgAccessActive: true,
  }),
}));

vi.mock("@/lib/visibility/data", () => ({
  getOrganizationForViewer: async () => ({
    organization: state.organization,
    contacts: state.contacts,
    brandColors: [],
    benchmarking: null,
    allBenchmarking: [],
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { exportOrgContacts } = await import("../export-page");

beforeEach(() => {
  state.organization = { id: "o1", name: "University of Example" };
  state.contacts = [];
});

describe("exportOrgContacts", () => {
  it("exports the contacts the viewer can see on the page", async () => {
    state.contacts = [
      {
        id: "c1",
        name: "Jane Buyer",
        role_title: "Course Materials Manager",
        work_email: "jbuyer@example.ca",
        work_phone_number: "403-555-1234",
      },
    ];

    const result = await exportOrgContacts("university-of-example");

    expect(result.error).toBeUndefined();
    expect(result.csv).toBe(
      "Name,Title,Email,Phone\nJane Buyer,Course Materials Manager,jbuyer@example.ca,403-555-1234"
    );
    expect(result.filename).toBe("University_of_Example_contacts.csv");
  });

  it("falls back to the legacy email/phone columns when the work ones are empty", async () => {
    state.contacts = [
      { id: "c1", name: "Jane Buyer", email: "old@example.ca", phone: "403-555-9999" },
    ];

    const result = await exportOrgContacts("university-of-example");

    expect(result.csv).toContain("old@example.ca");
    expect(result.csv).toContain("403-555-9999");
  });

  // The masking engine nulls a withheld contact's fields but keeps the row —
  // one partner exporting another partner's page gets a full array of blanks.
  // Handing that back as a CSV of bare commas is the same silent failure in a
  // new costume, so it has to be an explained refusal instead.
  it("refuses instead of emitting bare commas when every field is masked away", async () => {
    state.contacts = [
      { id: "c1", name: null, role_title: null, work_email: null, work_phone_number: null },
      { id: "c2", name: null, role_title: null, work_email: null, work_phone_number: null },
    ];

    const result = await exportOrgContacts("rival-vendor");

    expect(result.csv).toBeUndefined();
    expect(result.error).toBe("No contact details are available to you for University of Example.");
  });

  it("explains an empty contact list rather than downloading a header-only file", async () => {
    state.contacts = [];

    const result = await exportOrgContacts("university-of-example");

    expect(result.csv).toBeUndefined();
    expect(result.error).toMatch(/^No contact details are available to you/);
  });

  it("reports a missing org", async () => {
    state.organization = null;

    const result = await exportOrgContacts("nope");

    expect(result.error).toBe("Organization not found");
  });
});
