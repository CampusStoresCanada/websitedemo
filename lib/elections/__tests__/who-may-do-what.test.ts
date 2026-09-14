/**
 * Nominating is everyone at a member store. Voting is administrators.
 *
 * These two ran through ONE flag until they were split, so neither could widen
 * without the other. Now that they are separate, the failure mode is a call
 * site reaching for the wrong list — which is exactly what happened: the
 * nominee search API kept the admin gate after nominating widened, so staff
 * could open the form and submit it but got a 403 the moment they typed a name.
 *
 * Source-level, because the defect is a wrong identifier in a permission check.
 * Nothing observable breaks until the wrong person is refused, or the right one
 * is not.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

// resolveActor reads contacts for the profile; the role split it returns does
// not depend on them, so the client is stubbed and the split asserted directly.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: [] }) }) }),
  }),
}));

const read = (p: string) => readFileSync(p, "utf8");

/** Nominating, co-signing, and searching for a nominee: every member-store employee. */
const STAFF_PATHS = [
  "app/elections/[slug]/nominate/page.tsx",
  "app/api/elections/[slug]/nominatable/route.ts",
];

/** The ballot: administrators only. By-Law Part V — one ballot per institution. */
const ADMIN_ONLY = [
  {
    file: "lib/elections/service.ts",
    // saveBallot's actor check.
    needle: "if (!actor.adminOrganizationIds.includes(input.organizationId))",
  },
];

describe("nominating reaches every member-store employee", () => {
  for (const path of STAFF_PATHS) {
    it(`${path} scopes by staff, not admins`, () => {
      const source = read(path);
      expect(source).toContain("staffOrganizationIds");
    });
  }

  it("the search API and the submit action agree on who may nominate", () => {
    const route = read("app/api/elections/[slug]/nominatable/route.ts");
    const actions = read("lib/actions/elections.ts");
    expect(route).toContain("actor.staffOrganizationIds.map");
    expect(actions).toContain("if (!actor.staffOrganizationIds.includes(nominatorOrganizationId))");
    // The gate that was wrong: searching must not require administering a store.
    expect(route).not.toContain("actor.adminOrganizationIds.map");
  });
});

describe("the ballot stays with administrators", () => {
  for (const { file, needle } of ADMIN_ONLY) {
    it(`${file} refuses a non-administrator`, () => {
      expect(read(file)).toContain(needle);
    });
  }

  it("never widens saveBallot to staff", () => {
    const service = read("lib/elections/service.ts");
    // NB saveBallot, not castBallot — that one is lib/board/vote-service.ts,
    // a different subsystem entirely.
    const fn = service.slice(service.indexOf("export async function saveBallot"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).toContain("adminOrganizationIds");
    expect(body).not.toContain("staffOrganizationIds");
  });
});

describe("the split itself", () => {
  const MEMBERSHIPS = [
    { organization_id: "store-a", role: "org_admin", status: "active" },
    { organization_id: "store-b", role: "member", status: "active" },
    { organization_id: "store-c", role: "member", status: "inactive" },
  ];

  it("counts an administrator as staff too — they may nominate AND vote", async () => {
    const { resolveActor } = await import("../service");
    const actor = await resolveActor("p1", MEMBERSHIPS);
    expect(actor.adminOrganizationIds).toEqual(["store-a"]);
    expect(actor.staffOrganizationIds).toContain("store-a");
  });

  it("gives a plain member a nomination right and no ballot", async () => {
    const { resolveActor } = await import("../service");
    const actor = await resolveActor("p1", MEMBERSHIPS);
    expect(actor.staffOrganizationIds).toContain("store-b");
    expect(actor.adminOrganizationIds).not.toContain("store-b");
  });

  it("ignores an inactive membership for both", async () => {
    const { resolveActor } = await import("../service");
    const actor = await resolveActor("p1", MEMBERSHIPS);
    expect(actor.staffOrganizationIds).not.toContain("store-c");
    expect(actor.adminOrganizationIds).not.toContain("store-c");
  });
});
