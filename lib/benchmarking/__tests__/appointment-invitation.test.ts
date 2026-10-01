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
  /*
    ⛔ Appointing is LOADING THE AUDIENCE, not the invitation.

    It happens weeks early, while the survey is still being written, and it
    tells somebody they have been asked to do a job. Telling them to GO belongs
    to the state change — see sendBetaOpening. A beta appointment that mailed
    the going-first copy told people the survey was open for them weeks before
    it was, and the only symptom would have been a tester trying to file into a
    draft nobody had started.
  */
  it("sends the committee copy for a beta appointment, like every other workstream", async () => {
    const result = await sendAppointmentInvitation({
      subjectId: "p1",
      capability: CAPABILITIES.BENCHMARKING_BETA_TESTER,
    });

    expect(result.sent).toBe(true);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].templateKey).toBe("benchmarking_committee_invitation");
  });

  it("never sends the going-first copy at appointment time", async () => {
    await sendAppointmentInvitation({
      subjectId: "p1",
      capability: CAPABILITIES.BENCHMARKING_BETA_TESTER,
    });
    expect(state.sends.map((s) => s.templateKey)).not.toContain(
      "benchmarking_beta_invitation",
    );
  });

  it("leaves a committee workstream on the committee copy", async () => {
    await sendAppointmentInvitation({
      subjectId: "p1",
      capability: CAPABILITIES.BENCHMARKING_CONTENT_REVIEW,
    });

    expect(state.sends[0].templateKey).toBe("benchmarking_committee_invitation");
  });
});
