import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * One email per organisation, but one LOG ROW per (checklist, checkpoint, org).
 *
 * The reminder log is what stops an org being nagged twice for the same
 * checkpoint. Merging the EMAIL across checklists must not merge the log — if
 * a merged send wrote a single row, every other checklist that shared that
 * message would look unlogged and fire again on the next run.
 *
 * The database cannot catch this. Its unique index is on
 * (checkpoint_id, organization_id), which prevents DUPLICATE rows; this failure
 * is MISSING rows. It surfaces as silent repeat reminders months later, which
 * nobody would trace back to the merge — hence a test.
 */

const ORG = "org-1";
const CONFERENCE = "conf-1";

const CHECKLISTS = [
  {
    id: "cl-exhibitor", conference_id: CONFERENCE, name: "Exhibitor",
    deadline_at: "2027-01-11T04:59:00+00:00", scope_entity_id: null, publication_id: null,
    publication: null, conference: { year: 2027, edition_code: "csc2027" },
  },
  {
    id: "cl-directory", conference_id: CONFERENCE, name: "Directory Listing",
    deadline_at: "2026-11-02T04:59:00+00:00", scope_entity_id: null, publication_id: null,
    publication: null, conference: { year: 2027, edition_code: "csc2027" },
  },
];

const CHECKPOINTS: Record<string, { id: string; days_before_deadline: number }[]> = {
  "cl-exhibitor": [{ id: "cp-exhibitor", days_before_deadline: 3650 }],
  "cl-directory": [{ id: "cp-directory", days_before_deadline: 3650 }],
};

const TASKS: Record<string, unknown[]> = {
  "cl-exhibitor": [{ id: "t-1", name: "Assign booth staff", description: "d", check_type: "self_reported", check_entity_id: null }],
  "cl-directory": [{ id: "t-2", name: "Complete your listing", description: "d", check_type: "self_reported", check_entity_id: null }],
};

const captured = { logInserts: [] as unknown[][], campaigns: [] as { name: string; recipients: unknown[] }[] };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      const chain = (key?: string) => (col?: string, val?: unknown) => {
        if (key === "eq" && col) filters[col] = val;
        return b;
      };
      for (const m of ["select", "not", "in", "order", "limit", "is"]) b[m] = chain();
      b.eq = chain("eq");

      const rows = (): unknown[] => {
        switch (table) {
          case "conference_checklists": return CHECKLISTS;
          case "conference_checklist_checkpoints":
            return CHECKPOINTS[String(filters.checklist_id)] ?? [];
          case "conference_checklist_tasks":
            return TASKS[String(filters.checklist_id)] ?? [];
          case "entity_balances": return [{ organization_id: ORG }];
          case "conference_checklist_reminder_log": return [];
          case "organizations": return [{ name: "Greentown Canada", slug: "greentown" }];
          default: return [];
        }
      };
      b.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      b.insert = (r: unknown[]) => {
        if (table === "conference_checklist_reminder_log") captured.logInserts.push(r);
        return Promise.resolve({ error: null });
      };
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve);
      return b;
    },
  }),
}));

vi.mock("@/lib/comms/audience", () => ({
  resolveAudience: () => Promise.resolve([{ email: "admin@greentown.test", name: "Dana" }]),
}));

vi.mock("@/lib/comms/send", () => ({
  createCampaign: (input: { name: string; audience: { filters: { recipients: unknown[] } } }) => {
    captured.campaigns.push({ name: input.name, recipients: input.audience.filters.recipients });
    return Promise.resolve({ success: true, campaignId: "camp-1" });
  },
  executeCampaignSend: () => Promise.resolve({ success: true }),
}));

// Every task reads as outstanding, so both checklists have something to send.
vi.mock("../checklist-checks", () => ({
  CHECKS: new Proxy({}, { get: () => () => Promise.resolve(false) }),
  evaluateChecklistTaskCheck: () => Promise.resolve(false),
}));

beforeEach(() => {
  captured.logInserts = [];
  captured.campaigns = [];
});

describe("an org due on two checklists at once", () => {
  it("receives ONE email, not one per checklist", async () => {
    const { runChecklistReminders } = await import("../checklist-engine");
    await runChecklistReminders();

    expect(captured.campaigns).toHaveLength(1);
    // One recipient: the org's single admin, once — not once per checklist.
    expect(captured.campaigns[0].recipients).toHaveLength(1);
  });

  it("still logs BOTH checkpoints, so neither checklist fires again", async () => {
    const { runChecklistReminders } = await import("../checklist-engine");
    await runChecklistReminders();

    const logged = captured.logInserts.flat() as {
      checklist_id: string; checkpoint_id: string; organization_id: string;
    }[];
    expect(logged).toHaveLength(2);
    expect(logged.map((r) => r.checklist_id).sort()).toEqual(["cl-directory", "cl-exhibitor"]);
    expect(logged.map((r) => r.checkpoint_id).sort()).toEqual(["cp-directory", "cp-exhibitor"]);
    expect(new Set(logged.map((r) => r.organization_id))).toEqual(new Set([ORG]));
  });

  it("merges both checklists into one body, each under its own heading", async () => {
    const { runChecklistReminders } = await import("../checklist-engine");
    await runChecklistReminders();

    const recipient = captured.campaigns[0].recipients[0] as {
      variableOverrides: Record<string, string>;
    };
    const body = recipient.variableOverrides.open_items_html;
    expect(body).toContain("Exhibitor");
    expect(body).toContain("Directory Listing");
    // Neutral opening: a merge can mix a conference checklist with a directory
    // one, so asserting "for the conference" would be wrong for half of it.
    expect(recipient.variableOverrides.intro_line).toBe("has a few things outstanding:");
  });
});
