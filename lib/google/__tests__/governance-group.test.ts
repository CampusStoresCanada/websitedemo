/**
 * The board turns over once a year on a button. These pin the two things that
 * makes necessary: the work happens at the press, and the press is told the
 * truth about whether it landed.
 *
 * ⛔ The trap being guarded: Google answers 200 on an add that does not take
 * effect. Believing the 200 is how "I pressed the button" and "the board can
 * read its mail" came apart with nobody noticing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const listGroupMembers = vi.fn();
const addGroupMember = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/google/directory", () => ({
  workspaceConfigured: () => true,
  listGroupMembers: (...a: unknown[]) => listGroupMembers(...a),
  addGroupMember: (...a: unknown[]) => addGroupMember(...a),
}));

const RULE = { id: "r1", label: "Board mailing list", bodyKey: "board_of_directors", roleKey: "director" };

/** The two reads the sync makes, plus the last_run write it ends with. */
function stubDb(holderEmails: (string | null)[]) {
  const writes: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      if (table === "governance_bodies") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "b1" } }) }) }),
        };
      }
      if (table === "governance_role_assignments") {
        const rows = holderEmails.map((email) => ({ person_contact_id: "c", contacts: email ? { email } : null }));
        const res = Promise.resolve({ data: rows });
        return { select: () => ({ eq: () => ({ eq: () => ({ lte: () => ({ or: () => res }) }) }) }) };
      }
      return {
        update: (payload: Record<string, unknown>) => {
          writes.push(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };
  return { db, writes };
}

const member = (email: string, role = "MEMBER") => ({ email, role });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (db: any) =>
  (await import("../governance-group")).syncGovernanceGroupNow(db, RULE, "board@campusstores.ca");

beforeEach(() => {
  listGroupMembers.mockReset();
  addGroupMember.mockReset();
});

describe("syncing a governance group at the press", () => {
  it("adds the holders who are not there and confirms them against a read back", async () => {
    const { db } = stubDb(["a@uni.ca", "b@uni.ca"]);
    listGroupMembers
      .mockResolvedValueOnce([member("a@uni.ca")])
      .mockResolvedValueOnce([member("a@uni.ca"), member("b@uni.ca")]);
    addGroupMember.mockResolvedValue(undefined);

    const out = await run(db);
    expect(addGroupMember).toHaveBeenCalledTimes(1);
    expect(addGroupMember).toHaveBeenCalledWith("board@campusstores.ca", "b@uni.ca");
    expect(out.added).toEqual(["b@uni.ca"]);
    expect(out.alreadyThere).toEqual(["a@uni.ca"]);
    expect(out.verified).toBe(true);
    expect(out.missing).toEqual([]);
  });

  it("⛔ calls it missing when the add returned 200 and the member is still not there", async () => {
    const { db } = stubDb(["a@uni.ca", "ghost@uni.ca"]);
    // Both reads say the same thing: the add changed nothing.
    listGroupMembers.mockResolvedValue([member("a@uni.ca")]);
    addGroupMember.mockResolvedValue(undefined);

    const out = await run(db);
    expect(out.added).toEqual(["ghost@uni.ca"]);
    expect(out.missing).toEqual(["ghost@uni.ca"]);
    const { describeOutcome } = await import("../governance-group");
    expect(describeOutcome(out)).toContain("did not land");
  });

  it("keeps going when one add throws, and names the one that failed", async () => {
    const { db } = stubDb(["a@uni.ca", "b@uni.ca"]);
    listGroupMembers.mockResolvedValueOnce([]).mockResolvedValueOnce([member("b@uni.ca")]);
    addGroupMember
      .mockRejectedValueOnce(new Error("resource not found"))
      .mockResolvedValueOnce(undefined);

    const out = await run(db);
    expect(out.failed).toEqual([{ email: "a@uni.ca", reason: "resource not found" }]);
    expect(out.added).toEqual(["b@uni.ca"]);
    expect(out.missing).toEqual(["a@uni.ca"]);
  });

  it("counts who is on the list holding no role, and never touches them", async () => {
    const { db } = stubDb(["a@uni.ca"]);
    listGroupMembers.mockResolvedValue([
      member("a@uni.ca"),
      member("gone@uni.ca"),
      // An address CSC owns is a forwarder, and a MANAGER was made one by hand.
      member("info@campusstores.ca"),
      member("chair@uni.ca", "MANAGER"),
    ]);

    const out = await run(db);
    expect(out.stale).toEqual(["gone@uni.ca"]);
  });

  it("reports rather than throws when the group cannot be read at all", async () => {
    const { db } = stubDb(["a@uni.ca"]);
    listGroupMembers.mockRejectedValue(new Error("403 not authorized"));

    const out = await run(db);
    expect(out.error).toContain("could not read the group");
    expect(out.verified).toBe(false);
    expect(addGroupMember).not.toHaveBeenCalled();
  });

  it("writes what happened onto the rule, so the last run is this one", async () => {
    const { db, writes } = stubDb(["a@uni.ca"]);
    listGroupMembers.mockResolvedValue([member("a@uni.ca")]);

    await run(db);
    expect(writes).toHaveLength(1);
    expect(writes[0].last_run).toMatchObject({ holders: 1, queuedAdds: 0 });
    expect(writes[0].last_run_at).toBeTruthy();
  });

  it("drops a holder with no email rather than sending undefined to Google", async () => {
    const { db } = stubDb(["a@uni.ca", null]);
    listGroupMembers.mockResolvedValue([member("a@uni.ca")]);

    const out = await run(db);
    expect(out.wanted).toEqual(["a@uni.ca"]);
    expect(addGroupMember).not.toHaveBeenCalled();
  });
});
