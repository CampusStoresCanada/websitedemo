import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * checklist-engine reaches the mail layer at module scope, which constructs a
 * Resend client and throws without a key. Nothing here sends anything — these
 * exercise scope resolution only.
 */
vi.mock("@/lib/comms/send", () => ({
  createCampaign: async () => ({ success: true, campaignId: "c" }),
  executeCampaignSend: async () => ({ recipientCount: 0, sentCount: 0, failedCount: 0, errors: [] }),
}));
vi.mock("@/lib/comms/audience", () => ({ resolveAudience: async () => [] }));

/**
 * Measured 2026-09-16 on the 2027 conference: the Exhibitor checklist had no
 * scope, so it reached every org with any `entity_balances` row — 36 vendor
 * partners (35 with a booth), **11 member stores with no booth**, and 1 staff
 * org. Those twelve were being asked to "Order power and AV from Encore" and
 * "Place your Stronco order" for a booth they do not have.
 *
 * `scope_entity_id` could not fix it: it names ONE entity and the booths are 60
 * separately numbered ones across two archetypes. The scope is a CLASS of
 * holding, which is what `scope_entity_kind` says.
 *
 * Note the one vendor partner with no booth — "is a partner" would still have
 * been the wrong test. Holding a booth is the test.
 */

/** Minimal thenable PostgREST stub: records filters, returns canned rows. */
function fakeDb(tables: Record<string, (filters: Record<string, unknown>) => unknown[]>) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => { filters[col] = val; return builder; },
        in: (col: string, val: unknown) => { filters[`${col}__in`] = val; return builder; },
        not: () => builder,
        then: (resolve: (r: { data: unknown[] }) => unknown) =>
          resolve({ data: tables[table]?.(filters) ?? [] }),
      };
      return builder;
    },
  };
}

describe("scoping a checklist to a kind of holding", () => {
  const CONF = "conf-1";
  const checklist = {
    id: "cl-1",
    conference_id: CONF,
    scope_entity_id: null,
    scope_entity_kind: "booth",
    publication_id: null,
  };

  /** Two booths, and balances: one partner holds a booth, one member holds only a registration. */
  const db = fakeDb({
    conference_entities: (f) => (f.kind === "booth" ? [{ id: "booth-101" }, { id: "booth-102" }] : []),
    entity_balances: (f) => {
      const ids = (f.entity_id__in as string[] | undefined) ?? null;
      const rows = [
        { organization_id: "partner-with-booth", entity_id: "booth-101" },
        { organization_id: "member-no-booth", entity_id: "registration-full" },
        { organization_id: "partner-no-booth", entity_id: "registration-full" },
      ];
      return (ids ? rows.filter((r) => ids.includes(r.entity_id)) : rows).map((r) => ({
        organization_id: r.organization_id,
      }));
    },
  });

  it("returns only orgs holding something of that kind", async () => {
    const { resolveScopedOrgs } = await import("../checklist-engine");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await resolveScopedOrgs(db as any, checklist)).toEqual(["partner-with-booth"]);
  });

  it("excludes a member store that bought a registration but no booth", async () => {
    const { resolveScopedOrgs } = await import("../checklist-engine");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orgs = await resolveScopedOrgs(db as any, checklist);
    expect(orgs).not.toContain("member-no-booth");
    // and "is a partner" would not have been enough either
    expect(orgs).not.toContain("partner-no-booth");
  });

  it("reaches NOBODY when the kind matches no entity, rather than dropping the restriction", async () => {
    const { resolveScopedOrgs } = await import("../checklist-engine");
    const orgs = await resolveScopedOrgs(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      { ...checklist, scope_entity_kind: "spaceship" }
    );
    // Falling back to "everyone" is how the original bug read in production.
    expect(orgs).toEqual([]);
  });

  it("leaves an unscoped checklist reaching every purchaser", async () => {
    const { resolveScopedOrgs } = await import("../checklist-engine");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orgs = await resolveScopedOrgs(db as any, { ...checklist, scope_entity_kind: null });
    expect(orgs.sort()).toEqual(["member-no-booth", "partner-no-booth", "partner-with-booth"]);
  });
});

/**
 * The page and the email must answer this question in the same place. They
 * previously did not: the email scoped to purchasers, the page did not scope at
 * all. Source assertions because the classic failure is that the branch exists
 * and the column is never selected — the query quietly stops restricting and
 * nothing fails.
 */
describe("the org page asks the same question the email does", () => {
  const tasks = readFileSync("lib/conference/checklist-tasks.ts", "utf8");

  it("selects the scope columns, or scoping silently never engages", () => {
    expect(tasks).toMatch(/\.select\([^)]*scope_entity_kind/);
    expect(tasks).toMatch(/\.select\([^)]*scope_entity_id/);
  });

  it("resolves scope through the engine rather than reimplementing it", () => {
    expect(tasks).toContain("resolveScopedOrgs");
  });

  it("filters the checklists down to the ones this org is in scope for", () => {
    expect(tasks).toContain("scopedOrgIds.includes(organizationId)");
  });
});

/**
 * The scope belongs on the TASK, because the checklist is mixed.
 *
 * Of the Exhibitor checklist's six org tasks only two are about having a booth.
 * `seat_assigned` reports done when the org holds nothing of that kind and
 * `legal_document_accepted` resolves documents by conference tier — they scope
 * themselves. A `self_reported` task has nothing to read, so "have you ordered
 * power for your booth?" reaches a member store unless the task says otherwise.
 *
 * Scoping the whole checklist instead would have stopped the 11 attending
 * member stores being reminded to PAY, which is the opposite of the bug.
 */
describe("scoping a single task inside a mixed checklist", () => {
  const CONF = "conf-1";
  const db = fakeDb({
    conference_entities: (f) => (f.kind === "booth" ? [{ id: "booth-101" }] : []),
    entity_balances: (f) => {
      const ids = (f.entity_id__in as string[] | undefined) ?? null;
      const rows = [
        { organization_id: "partner-with-booth", entity_id: "booth-101" },
        { organization_id: "member-no-booth", entity_id: "registration-full" },
      ];
      return (ids ? rows.filter((r) => ids.includes(r.entity_id)) : rows).map((r) => ({
        organization_id: r.organization_id,
      }));
    },
  });

  const TASKS = [
    { id: "pay", scope_entity_kind: null },
    { id: "legal", scope_entity_kind: null },
    { id: "encore", scope_entity_kind: "booth" },
    { id: "stronco", scope_entity_kind: "booth" },
  ];

  it("keeps the booth tasks for an org with a booth", async () => {
    const { filterTasksToOrgScope } = await import("../checklist-engine");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kept = await filterTasksToOrgScope(db as any, CONF, "partner-with-booth", TASKS);
    expect(kept.map((t) => t.id)).toEqual(["pay", "legal", "encore", "stronco"]);
  });

  it("drops only the booth tasks for a member store with no booth", async () => {
    const { filterTasksToOrgScope } = await import("../checklist-engine");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kept = await filterTasksToOrgScope(db as any, CONF, "member-no-booth", TASKS);
    // The point of the whole change: they still get asked to pay.
    expect(kept.map((t) => t.id)).toEqual(["pay", "legal"]);
  });

  it("asks one question per kind, not one per task", async () => {
    let entityQueries = 0;
    const counting = fakeDb({
      conference_entities: () => { entityQueries++; return [{ id: "booth-101" }]; },
      entity_balances: () => [{ organization_id: "partner-with-booth" }],
    });
    const { filterTasksToOrgScope } = await import("../checklist-engine");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await filterTasksToOrgScope(counting as any, CONF, "partner-with-booth", TASKS);
    expect(entityQueries).toBe(1); // two booth tasks, one lookup
  });
});
