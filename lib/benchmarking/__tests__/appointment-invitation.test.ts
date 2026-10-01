import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Which template an appointment mails, and to whom.
 *
 * Appointing a beta tester IS the beta invitation — the second sender that
 * addressed the store's respondent has been deleted — so if this routes to the
 * generic committee copy, nobody is ever told that their submission is real,
 * that flagging beats guessing, or that there is a wipe. The appointment still
 * succeeds and the omission is invisible, which is exactly the kind of failure
 * worth a test.
 */

// appointment-invitation.ts is server-only; vitest cannot resolve that package.
// Same stub the publication suites use.
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  sends: [] as { templateKey: string; to: string; variables: Record<string, unknown> }[],
  orgName: "Conestoga College" as string | null,
  survey: { fiscal_year: 2026, opens_at: "2026-10-08T12:00:00+00" } as
    | { fiscal_year: number; opens_at: string | null }
    | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // The address comes from auth, not from contacts: an appointment is made
    // against a profile, and the profile's login is the one address we know
    // reaches them.
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "pat@store.ca" } } }),
      },
    },
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "p1", display_name: "Pat Lee", email: "pat@store.ca" },
              }),
            }),
          }),
        };
      }
      if (table === "user_organizations") {
        const b: Record<string, unknown> = {
          eq: () => b,
          limit: () => b,
          maybeSingle: async () => ({
            data: state.orgName
              ? { organization_id: "org-1", organizations: { name: state.orgName } }
              : null,
          }),
        };
        return { select: () => b };
      }
      if (table === "benchmarking_surveys") {
        const b: Record<string, unknown> = {
          order: () => b,
          limit: () => b,
          maybeSingle: async () => ({ data: state.survey }),
        };
        return { select: () => b };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/lib/comms/send", () => ({
  sendTransactional: async (opts: {
    templateKey: string;
    to: string;
    variables: Record<string, unknown>;
  }) => {
    state.sends.push(opts);
    return { success: true };
  },
}));

import { sendAppointmentInvitation } from "../appointment-invitation";
import { CAPABILITIES } from "@/lib/auth/capability-names";

beforeEach(() => {
  state.sends = [];
  state.orgName = "Conestoga College";
  state.survey = { fiscal_year: 2026, opens_at: "2026-10-08T12:00:00+00" };
});

describe("appointment invitations", () => {
  it("sends the going-first copy for a beta appointment, not the committee copy", async () => {
    const result = await sendAppointmentInvitation({
      subjectId: "p1",
      capability: CAPABILITIES.BENCHMARKING_BETA_TESTER,
    });

    expect(result.sent).toBe(true);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].templateKey).toBe("benchmarking_beta_invitation");
  });

  it("names the store and the year the beta copy asks for", async () => {
    await sendAppointmentInvitation({
      subjectId: "p1",
      capability: CAPABILITIES.BENCHMARKING_BETA_TESTER,
    });

    const v = state.sends[0].variables;
    expect(v.organization_name).toBe("Conestoga College");
    expect(v.fiscal_year).toBe("2026");
    // Every variable the template declares must be filled, or the reader gets
    // a literal [placeholder] in their inbox.
    for (const key of [
      "contact_name",
      "organization_name",
      "fiscal_year",
      "opens_date",
      "survey_url",
    ]) {
      expect(String(v[key] ?? "")).not.toBe("");
    }
  });

  it("still sends, naming no store, when the appointee has no org link", async () => {
    state.orgName = null;

    const result = await sendAppointmentInvitation({
      subjectId: "p1",
      capability: CAPABILITIES.BENCHMARKING_BETA_TESTER,
    });

    // ⛔ Mail is a courtesy and must never be the thing that makes an
    // appointment look failed. Degrades to a phrase rather than refusing.
    expect(result.sent).toBe(true);
    expect(state.sends[0].variables.organization_name).toBe("your store");
  });

  it("leaves a committee workstream on the committee copy", async () => {
    await sendAppointmentInvitation({
      subjectId: "p1",
      capability: CAPABILITIES.BENCHMARKING_CONTENT_REVIEW,
    });

    expect(state.sends[0].templateKey).toBe("benchmarking_committee_invitation");
  });
});
