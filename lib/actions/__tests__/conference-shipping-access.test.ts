import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may ship for whom. Desk staff: anyone on the roster. An attendee on
 * /me: only themselves, and only while the conference is on.
 */

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  staff: false,
  ownRow: true as boolean,
  today: "2027-02-02",
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAuthenticated: async () => ({ ok: true, ctx: { userId: "user-1" } }),
  isConferenceDeskStaff: async () => state.staff,
  requireConferenceDeskAccess: async () => ({ ok: state.staff, ctx: { userId: "user-1" }, error: "desk only" }),
  requireConferenceOpsAccess: async () => ({ ok: false, error: "ops only" }),
}));
vi.mock("@/lib/conference/desk-staff", () => ({ conferenceToday: async () => state.today }));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: async () => undefined }));
vi.mock("@/lib/conference/shipping-notify", () => ({ notifyShipmentBooked: async () => undefined }));
vi.mock("@/lib/purolator/shipping", () => ({ estimateShipment: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq", "neq"]) b[m] = () => b;
      b.maybeSingle = async () => {
        if (table === "conference_people") return { data: state.ownRow ? { id: "person-1" } : null };
        if (table === "conference_instances") return { data: { start_date: "2027-02-01", end_date: "2027-02-04" } };
        return { data: null };
      };
      return b;
    },
  }),
}));

const { quoteConferenceShipment } = await import("../conference-shipping");

// An address with no street: if access passes, the answer is the address problem.
const params = {
  conferenceId: "conf-1",
  personId: "person-1",
  destination: { company: "", attention: "", street: "", street2: "", city: "", province: "", postalCode: "", phone: "" },
  boxes: [],
};

beforeEach(() => {
  state.staff = false;
  state.ownRow = true;
  state.today = "2027-02-02";
});

describe("shipping access", () => {
  it("lets an attendee ship their own boxes during the conference", async () => {
    expect(await quoteConferenceShipment(params)).toEqual({ success: false, error: "Add the street address." });
  });

  it("refuses an attendee shipping for somebody else", async () => {
    state.ownRow = false;
    expect(await quoteConferenceShipment(params)).toEqual({ success: false, error: "You can only ship your own boxes." });
  });

  it("refuses an attendee before the conference starts", async () => {
    state.today = "2027-01-31";
    expect(await quoteConferenceShipment(params)).toEqual({
      success: false,
      error: "Shipping opens on the first day of the conference.",
    });
  });

  it("lets desk staff ship for anyone, on any day", async () => {
    state.staff = true;
    state.ownRow = false;
    state.today = "2026-11-04";
    expect(await quoteConferenceShipment(params)).toEqual({ success: false, error: "Add the street address." });
  });
});
