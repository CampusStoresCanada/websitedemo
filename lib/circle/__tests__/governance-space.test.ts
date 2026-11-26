/**
 * Putting the board into the board's Circle spaces.
 *
 * The sibling of `lib/google/__tests__/governance-group.test.ts`, and it guards
 * the same class of trap in a different store: Circle answers 200 on a write
 * that does not take, 422 on an add for somebody already there, and
 * `create_space_group_member` CLAIMS to add to every space in the group. None of
 * those are evidence, so the membership is read back and diffed.
 *
 * ⛔ The two surfaces matter independently. `is_hidden_from_non_members` is true
 * on the Board of Directors group, so a director in both spaces but not in the
 * group has access to spaces they cannot see in their sidebar.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const findMemberByEmail = vi.fn();
const listSpaceMemberIds = vi.fn();
const addMemberToSpace = vi.fn();
const removeMemberFromSpace = vi.fn();
const listSpaceGroupMemberIds = vi.fn();
const addMemberToSpaceGroup = vi.fn();
const removeMemberFromSpaceGroup = vi.fn();
const listSpaces = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/circle/config", () => ({ isCircleConfigured: () => true }));
vi.mock("@/lib/circle/client", () => ({
  getCircleClient: () => ({
    findMemberByEmail: (...a: unknown[]) => findMemberByEmail(...a),
    listSpaceMemberIds: (...a: unknown[]) => listSpaceMemberIds(...a),
    addMemberToSpace: (...a: unknown[]) => addMemberToSpace(...a),
    removeMemberFromSpace: (...a: unknown[]) => removeMemberFromSpace(...a),
    listSpaceGroupMemberIds: (...a: unknown[]) => listSpaceGroupMemberIds(...a),
    addMemberToSpaceGroup: (...a: unknown[]) => addMemberToSpaceGroup(...a),
    removeMemberFromSpaceGroup: (...a: unknown[]) => removeMemberFromSpaceGroup(...a),
    listSpaces: (...a: unknown[]) => listSpaces(...a),
  }),
}));

const SPACE = 1749439;
const GROUP = 607909;
const RULE = {
  id: "r1",
  label: "Board Stuff (Circle)",
  bodyKey: "board_of_directors",
  roleKey: "director",
  spaceId: SPACE,
  alwaysMembers: [] as string[],
};
const AS_OF = "2027-06-30";

interface StubRow {
  email: string | null;
  termStart?: string;
  termEnd?: string | null;
  accessFrom?: string | null;
  accessUntil?: string | null;
  countsTowardCap?: boolean;
}

function stubDb(holders: (string | StubRow)[]) {
  return {
    from(table: string) {
      if (table === "governance_bodies") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "b1" } }) }) }),
        };
      }
      if (table === "governance_role_assignments") {
        const rows = holders.map((h) => {
          const r: StubRow = typeof h === "string" ? { email: h } : h;
          return {
            person_contact_id: r.email ?? "c",
            term_start: r.termStart ?? "2000-01-01",
            term_end: r.termEnd === undefined ? null : r.termEnd,
            access_from: r.accessFrom ?? null,
            access_until: r.accessUntil ?? null,
            counts_toward_cap: r.countsTowardCap ?? true,
            contacts: r.email ? { email: r.email } : null,
          };
        });
        const res = Promise.resolve({ data: rows, error: null });
        return { select: () => ({ eq: () => ({ eq: () => res }) }) };
      }
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [] }) }) }) }) };
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (db: any, asOf = AS_OF) =>
  (await import("../governance-space")).syncGovernanceSpaceNow(db, RULE, { asOf });

const circleIds: Record<string, number> = {
  "jackie@x.ca": 101,
  "sam@x.ca": 102,
  "old@x.ca": 103,
};

beforeEach(() => {
  vi.clearAllMocks();
  findMemberByEmail.mockImplementation((email: string) =>
    Promise.resolve(circleIds[email] ? { id: circleIds[email] } : null)
  );
  listSpaces.mockResolvedValue([{ id: SPACE, space_group_id: GROUP }]);
  listSpaceGroupMemberIds.mockResolvedValue([]);
  addMemberToSpace.mockResolvedValue(undefined);
  addMemberToSpaceGroup.mockResolvedValue(undefined);
  removeMemberFromSpace.mockResolvedValue(undefined);
  removeMemberFromSpaceGroup.mockResolvedValue(undefined);
});

describe("putting holders into the space", () => {
  it("adds a holder who is not in the space, and reports it", async () => {
    listSpaceMemberIds.mockResolvedValueOnce([]).mockResolvedValueOnce([101]);
    const out = await run(stubDb(["jackie@x.ca"]));
    expect(addMemberToSpace).toHaveBeenCalledWith(SPACE, "jackie@x.ca");
    expect(out.added).toEqual(["jackie@x.ca"]);
    expect(out.stillMissing).toEqual([]);
    expect(out.problems).toEqual([]);
  });

  it("⛔ does NOT re-add somebody already in the space", async () => {
    // Circle answers 422 to an add for somebody already there — 2,355 failed
    // queue rows were how the conference reconciler learned this.
    listSpaceMemberIds.mockResolvedValue([101]);
    const out = await run(stubDb(["jackie@x.ca"]));
    expect(addMemberToSpace).not.toHaveBeenCalled();
    expect(out.added).toEqual([]);
  });

  it("⛔ reports a write that did not take, however Circle answered", async () => {
    // The whole reason for the read-back: before says empty, the add "succeeds",
    // and afterwards they are still not there.
    listSpaceMemberIds.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const out = await run(stubDb(["jackie@x.ca"]));
    expect(out.added).toEqual(["jackie@x.ca"]);
    expect(out.stillMissing).toEqual(["jackie@x.ca"]);
  });

  it("names a holder with no Circle account instead of pretending", async () => {
    listSpaceMemberIds.mockResolvedValue([]);
    const out = await run(stubDb(["nobody@x.ca"]));
    expect(out.noCircleAccount).toEqual(["nobody@x.ca"]);
    expect(addMemberToSpace).not.toHaveBeenCalled();
  });
});

describe("the space GROUP, which is what makes the spaces visible", () => {
  it("adds the holder to the group as well as the space", async () => {
    listSpaceMemberIds.mockResolvedValueOnce([]).mockResolvedValueOnce([101]);
    const out = await run(stubDb(["jackie@x.ca"]));
    expect(addMemberToSpaceGroup).toHaveBeenCalledWith(GROUP, "jackie@x.ca");
    expect(out.spaceGroupId).toBe(GROUP);
  });

  it("⛔ says so when the space worked but the group did not", async () => {
    // Access to a space they cannot see in their sidebar is the failure this
    // catches, and it is invisible if only the space is checked.
    listSpaceMemberIds.mockResolvedValueOnce([]).mockResolvedValueOnce([101]);
    addMemberToSpaceGroup.mockRejectedValue(new Error("403"));
    const out = await run(stubDb(["jackie@x.ca"]));
    expect(out.added).toEqual(["jackie@x.ca"]);
    expect(out.problems.join(" ")).toMatch(/hidden in their sidebar/);
  });

  it("does not re-add somebody already in the group", async () => {
    listSpaceMemberIds.mockResolvedValue([101]);
    listSpaceGroupMemberIds.mockResolvedValue([101]);
    await run(stubDb(["jackie@x.ca"]));
    expect(addMemberToSpaceGroup).not.toHaveBeenCalled();
  });
});

describe("taking people off", () => {
  it("removes a director whose access has ended", async () => {
    listSpaceMemberIds.mockResolvedValueOnce([103]).mockResolvedValueOnce([]);
    listSpaceGroupMemberIds.mockResolvedValue([103]);
    const out = await run(
      stubDb([{ email: "old@x.ca", termStart: "2020-01-01", termEnd: "2026-01-01" }])
    );
    expect(removeMemberFromSpace).toHaveBeenCalledWith(SPACE, "old@x.ca");
    expect(removeMemberFromSpaceGroup).toHaveBeenCalledWith(GROUP, "old@x.ca");
    expect(out.removed).toEqual(["old@x.ca"]);
  });

  it("⛔ never removes somebody the register knows nothing about", async () => {
    // A board space legitimately holds staff, the Executive Director and five
    // Ghost accounts. `wanted` is the allow-list for ADDS only; a rule that
    // removed everyone not wanted would empty the space of people a human put
    // there on purpose.
    listSpaceMemberIds.mockResolvedValue([999, 101]);
    const out = await run(stubDb(["jackie@x.ca"]));
    expect(removeMemberFromSpace).not.toHaveBeenCalled();
    expect(out.removed).toEqual([]);
  });

  it("⛔ decides by asOf, not by today", async () => {
    // An outgoing director keeps access through the conference that follows the
    // AGM. Reading "who holds this" against the wall clock answers a different
    // question than the screen that triggered the sync.
    listSpaceMemberIds.mockResolvedValue([103]);
    const row = { email: "old@x.ca", termStart: "2020-01-01", termEnd: "2026-01-01", accessUntil: "2027-07-31" };
    const out = await run(stubDb([row]), "2027-06-30");
    expect(out.wanted).toContain("old@x.ca");
    expect(removeMemberFromSpace).not.toHaveBeenCalled();
    expect(out.removed).toEqual([]);
  });
});

describe("moderator", () => {
  it("⛔ names everyone who needs it by hand, because the API cannot set it", async () => {
    // Circle's admin API has POST and DELETE for a space member, no update. The
    // flags are also per surface and already disagree: Carolyn Potter is a
    // moderator on the GROUP and not one in Board Stuff.
    listSpaceMemberIds.mockResolvedValueOnce([]).mockResolvedValueOnce([101]);
    const out = await run(stubDb(["jackie@x.ca"]));
    expect(out.moderatorByHand).toEqual(["jackie@x.ca"]);
  });
});
