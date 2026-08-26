import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * These pin the rules that decide who gets mail, not the copy.
 *
 * The expensive failures here are social, not technical: mailing a store twice,
 * chasing someone who already filed, or chasing someone who was never invited.
 * Each of those costs goodwill with exactly the 15 stores this cycle is trying
 * to win back, so each one gets a test.
 */

const state = vi.hoisted(() => ({
  survey: {
    id: "survey-1",
    fiscal_year: 2026,
    status: "open",
    opens_at: "2026-10-08T12:00:00+00",
    closes_at: "2026-11-21T08:00:00+00",
  } as Record<string, unknown> | null,
  recipients: [] as Record<string, unknown>[],
  submissions: [] as Record<string, unknown>[],
  updates: [] as { id: string; patch: Record<string, unknown> }[],
  sends: [] as { templateKey: string; to: string; variables: Record<string, unknown> }[],
  sendResult: { success: true } as { success: boolean; error?: string },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "benchmarking_surveys") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.survey }) }) }),
        };
      }
      if (table === "benchmarking") {
        return { select: () => ({ eq: async () => ({ data: state.submissions }) }) };
      }
      // benchmarking_recipients: a chainable builder that is also awaitable, so
      // the same object serves .eq().is() and a bare await.
      const rows = () => ({ data: state.recipients });
      const builder: Record<string, unknown> = {
        eq: () => builder,
        is: () => builder,
        then: (res: (v: unknown) => unknown) => Promise.resolve(rows()).then(res),
      };
      return {
        select: () => builder,
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            state.updates.push({ id, patch });
            return { error: null };
          },
        }),
      };
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
    return state.sendResult;
  },
}));

import {
  sendBenchmarkingInvitations,
  sendBenchmarkingReminders,
  planInvitations,
  planReminders,
} from "../notify";

function recipient(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    organization_id: "org-1",
    contact_id: "c1",
    is_beta: false,
    invited_at: null,
    reminder_count: 0,
    organizations: { name: "Test University" },
    contacts: { name: "Pat Lee", first_name: "Pat", email: null, work_email: "pat@test.ca" },
    ...over,
  };
}

beforeEach(() => {
  state.recipients = [recipient()];
  state.submissions = [];
  state.updates = [];
  state.sends = [];
  state.sendResult = { success: true };
  delete process.env.BENCHMARKING_SUPPRESS_EMAIL;
});

describe("benchmarking invitations", () => {
  it("sends the general invitation and stamps invited_at", async () => {
    const result = await sendBenchmarkingInvitations("survey-1");

    expect(result.sent).toBe(1);
    expect(state.sends[0].templateKey).toBe("benchmarking_invitation");
    expect(state.sends[0].to).toBe("pat@test.ca");
    expect(state.updates[0].patch).toHaveProperty("invited_at");
  });

  it("sends the going-first copy when betaOnly is set", async () => {
    await sendBenchmarkingInvitations("survey-1", { betaOnly: true });
    expect(state.sends[0].templateKey).toBe("benchmarking_beta_invitation");
  });

  it("records the error and does NOT stamp invited_at when the send fails", async () => {
    state.sendResult = { success: false, error: "Bounced" };

    const result = await sendBenchmarkingInvitations("survey-1");

    expect(result.failed).toBe(1);
    expect(state.updates[0].patch).not.toHaveProperty("invited_at");
    expect(state.updates[0].patch.last_send_error).toBe("Bounced");
  });

  it("blocks a store with no address instead of attempting it", async () => {
    state.recipients = [
      recipient({ contacts: { name: "Pat", first_name: "Pat", email: null, work_email: null } }),
    ];

    const result = await sendBenchmarkingInvitations("survey-1");

    // Blocked at plan time rather than attempted and reported as a failure.
    // The operator sees it in the preview BEFORE sending, which is the point.
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(state.sends).toHaveLength(0);
  });

  it("sends nothing at all when the kill switch is set", async () => {
    process.env.BENCHMARKING_SUPPRESS_EMAIL = "1";

    const result = await sendBenchmarkingInvitations("survey-1");

    expect(state.sends).toHaveLength(0);
    expect(result.outcomes[0].error).toBe("suppressed");
  });

  it("prefers the work address over a personal one", async () => {
    state.recipients = [
      recipient({
        contacts: {
          name: "Pat",
          first_name: "Pat",
          email: "pat@gmail.com",
          work_email: "pat@test.ca",
        },
      }),
    ];
    await sendBenchmarkingInvitations("survey-1");
    expect(state.sends[0].to).toBe("pat@test.ca");
  });
});

describe("benchmarking reminders", () => {
  it("never chases a store that has already submitted", async () => {
    state.recipients = [recipient({ invited_at: "2026-10-08T12:00:00Z" })];
    state.submissions = [{ organization_id: "org-1", status: "submitted" }];

    const result = await sendBenchmarkingReminders("survey-1");

    expect(result.skipped).toBe(1);
    expect(state.sends).toHaveLength(0);
  });

  it("DOES chase a store that only saved a draft", async () => {
    state.recipients = [recipient({ invited_at: "2026-10-08T12:00:00Z" })];
    state.submissions = [{ organization_id: "org-1", status: "draft" }];

    const result = await sendBenchmarkingReminders("survey-1");

    expect(result.sent).toBe(1);
    expect(state.sends[0].templateKey).toBe("benchmarking_reminder");
  });

  it("never chases a store that was never successfully invited", async () => {
    state.recipients = [recipient({ invited_at: null })];

    const result = await sendBenchmarkingReminders("survey-1");

    expect(result.skipped).toBe(1);
    expect(state.sends).toHaveLength(0);
  });

  it("increments reminder_count so repeat chasing is visible", async () => {
    state.recipients = [recipient({ invited_at: "2026-10-08T12:00:00Z", reminder_count: 2 })];

    await sendBenchmarkingReminders("survey-1");

    expect(state.updates[0].patch.reminder_count).toBe(3);
  });
});

describe("the plan the operator is shown", () => {
  it("is the same list the send uses — not a second, similar query", async () => {
    state.recipients = [
      recipient({ id: "a", organization_id: "org-a" }),
      recipient({ id: "b", organization_id: "org-b", invited_at: "2026-10-08T12:00:00Z" }),
      recipient({
        id: "c",
        organization_id: "org-c",
        contacts: { name: "No Mail", first_name: "No", email: null, work_email: null },
      }),
    ];

    const plan = await planInvitations("survey-1");
    await sendBenchmarkingInvitations("survey-1");

    expect(plan!.willSend.map((l) => l.organizationId)).toEqual(["org-a"]);
    expect(state.sends).toHaveLength(1);
  });

  it("says WHY each blocked store is blocked", async () => {
    state.recipients = [
      recipient({ id: "b", invited_at: "2026-10-08T12:00:00Z" }),
      recipient({
        id: "c",
        contacts: { name: "No Mail", first_name: "No", email: null, work_email: null },
      }),
    ];

    const plan = await planInvitations("survey-1");
    expect(plan!.blocked.map((l) => l.blockedReason).sort()).toEqual([
      "already_invited",
      "no_address",
    ]);
  });

  it("surfaces the kill switch, so a no-op send is never mistaken for a real one", async () => {
    process.env.BENCHMARKING_SUPPRESS_EMAIL = "1";
    const plan = await planInvitations("survey-1");
    expect(plan!.killSwitchOn).toBe(true);
  });

  it("reminder plan separates submitted from never-invited", async () => {
    state.recipients = [
      recipient({ id: "s", organization_id: "org-s", invited_at: "2026-10-08T12:00:00Z" }),
      recipient({ id: "n", organization_id: "org-n", invited_at: null }),
    ];
    state.submissions = [{ organization_id: "org-s", status: "submitted" }];

    const plan = await planReminders("survey-1");
    expect(plan!.willSend).toHaveLength(0);
    expect(plan!.blocked.map((l) => l.blockedReason).sort()).toEqual([
      "already_submitted",
      "never_invited",
    ]);
  });
});
