import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

/*
  Which store a page is about — the one question whose wrong answer means a
  member filling in somebody else's survey.

  ⛔ This resolver has been broken twice, both times by the isAdmin check
  landing on the wrong clause, and both times it survived review because the
  happy path kept working: an admin could still act as another store, a member
  still saw their own. What changed silently was whether a MEMBER could pass
  ?org= and be handed a store that is not theirs. Nothing covered that, so
  nothing caught it.

  The application reads benchmarking through the service role, which bypasses
  RLS entirely. The policy on the table is real and correct, and it is not what
  protects this path — this function is.
*/

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          maybeSingle: async () => ({ data: null }),
          is: () => ({ order: async () => ({ data: [] }) }),
          order: async () => ({ data: [] }),
        }),
        is: () => ({ order: async () => ({ data: [] }) }),
        in: () => ({ eq: async () => ({ data: [] }) }),
        order: async () => ({ data: [] }),
      }),
    }),
  }),
}));

import { resolveActingOrg } from "../acting-org";

const MINE = {
  id: "org-mine",
  name: "My Store",
  slug: "my-store",
  type: "Member",
  archived_at: null,
};

const member = (role: string) => [{ role, organization: MINE }];

describe("which store the survey is about", () => {
  it("hands a member their own store", async () => {
    const r = await resolveActingOrg({
      userOrgs: member("org_admin"),
      isAdmin: false,
      requestedOrgId: null,
      surveyId: null,
    });
    expect(r.organization?.id).toBe("org-mine");
    expect(r.isActingAsOther).toBe(false);
  });

  it("⛔ IGNORES ?org= for a member, however valid the id looks", async () => {
    const r = await resolveActingOrg({
      userOrgs: member("org_admin"),
      isAdmin: false,
      // A real store, just not theirs.
      requestedOrgId: "org-someone-else",
      surveyId: null,
    });

    // Their own store, not the one they asked for, and not nothing.
    expect(r.organization?.id).toBe("org-mine");
    expect(r.isActingAsOther).toBe(false);
    expect(r.adminOrgOptions).toEqual([]);
  });

  it("gives a member no roster to pick from", async () => {
    const r = await resolveActingOrg({
      userOrgs: member("org_admin"),
      isAdmin: false,
      requestedOrgId: null,
      surveyId: null,
    });
    // A roster is the admin affordance. A member offered one would be a member
    // who can see that other stores exist to be acted as.
    expect(r.adminOrgOptions).toEqual([]);
  });

  it("resolves nothing for someone with no member store at all", async () => {
    const r = await resolveActingOrg({
      userOrgs: [],
      isAdmin: false,
      requestedOrgId: "org-someone-else",
      surveyId: null,
    });
    expect(r.organization).toBeNull();
    expect(r.isActingAsOther).toBe(false);
  });

  it("does not treat a partner-org link as a member store", async () => {
    /*
      ⛔ A Vendor Partner admin is an org admin of something, and the role
      string alone does not say of what. Reading the role without the type is
      how a partner ends up holding a member store's survey.
    */
    const r = await resolveActingOrg({
      userOrgs: [
        {
          role: "org_admin",
          organization: { ...MINE, id: "org-partner", type: "Vendor Partner" },
        },
      ],
      isAdmin: false,
      requestedOrgId: null,
      surveyId: null,
    });
    expect(r.organization).toBeNull();
  });
});
