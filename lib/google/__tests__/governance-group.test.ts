/**
 * The board turns over once a year on a button. These pin the three things
 * that makes necessary: the work happens at the press, the press is told the
 * truth about whether it landed, and the dates it reasons about are the ones
 * entered rather than whatever today happens to be.
 *
 * ⛔ The trap being guarded: Google answers 200 on a write that does not take
 * effect — on an add and on a delete alike. Believing the 200 is how "I pressed
 * the button" and "the right people can read the board's mail" came apart with
 * nobody noticing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const listGroupMembers = vi.fn();
const addGroupMember = vi.fn();
const removeGroupMember = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/google/directory", () => ({
  workspaceConfigured: () => true,
  listGroupMembers: (...a: unknown[]) => listGroupMembers(...a),
  addGroupMember: (...a: unknown[]) => addGroupMember(...a),
  removeGroupMember: (...a: unknown[]) => removeGroupMember(...a),
}));

const RULE = { id: "r1", label: "Board mailing list", bodyKey: "board_of_directors", roleKey: "director" };
const AS_OF = "2027-06-30";

/** The two reads the sync makes, plus the last_run write it ends with. */
function stubDb(holderEmails: (string | null)[]) {
  const writes: Record<string, unknown>[] = [];
  const asked: { lte?: unknown[]; or?: unknown[] } = {};
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
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                lte: (...a: unknown[]) => {
                  asked.lte = a;
                  return {
                    or: (...b: unknown[]) => {
                      asked.or = b;
                      return res;
                    },
                  };
                },
              }),
            }),
          }),
        };
      }
      return {
        update: (payload: Record<string, unknown>) => {
          writes.push(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  };
  return { db, writes, asked };
}

const member = (email: string, role = "MEMBER") => ({ email, role });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (db: any, req: { asOf?: string; remove?: string[]; retain?: string[] } = {}) =>
  (await import("../governance-group")).syncGovernanceGroupNow(db, RULE, "board@campusstores.ca", {
    asOf: req.asOf ?? AS_OF,
    remove: req.remove,
    retain: req.retain,
  });

beforeEach(() => {
  listGroupMembers.mockReset();
  addGroupMember.mockReset();
  removeGroupMember.mockReset();
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
    expect(out.failed).toEqual([
      { email: "a@uni.ca", reason: "resource not found", action: "add" },
    ]);
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
    expect(removeGroupMember).not.toHaveBeenCalled();
  });

  it("reports rather than throws when the group cannot be read at all", async () => {
    const { db } = stubDb(["a@uni.ca"]);
    listGroupMembers.mockRejectedValue(new Error("403 not authorized"));

    const out = await run(db);
    expect(out.error).toContain("could not read the group");
    expect(out.verified).toBe(false);
    expect(addGroupMember).not.toHaveBeenCalled();
    expect(removeGroupMember).not.toHaveBeenCalled();
  });

  it("writes what happened onto the rule, so the last run is this one", async () => {
    const { db, writes } = stubDb(["a@uni.ca"]);
    listGroupMembers.mockResolvedValue([member("a@uni.ca")]);

    await run(db);
    expect(writes).toHaveLength(1);
    expect(writes[0].last_run).toMatchObject({ holders: 1, queuedAdds: 0, queuedRemoves: 0 });
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

describe("the date the press was given", () => {
  it("⛔ asks who holds the role as of the entered date, not today", async () => {
    const { db, asked } = stubDb(["a@uni.ca"]);
    listGroupMembers.mockResolvedValue([member("a@uni.ca")]);

    const out = await run(db, { asOf: "2028-07-14" });
    expect(asked.lte).toEqual(["term_start", "2028-07-14"]);
    // term_end is EXCLUSIVE, so a term ending on the date is over by then.
    expect(asked.or).toEqual(["term_end.is.null,term_end.gt.2028-07-14"]);
    expect(out.asOf).toBe("2028-07-14");
    expect(asked.or?.[0]).not.toContain(new Date().toISOString().slice(0, 10));
  });

  it("does not call somebody drift when they are retained on purpose", async () => {
    // CSC's outgoing directors hold no term after the meeting but keep the
    // mailing list until the conference ends. At the seating press they must
    // not be reported as strays.
    const { db } = stubDb(["new@uni.ca"]);
    listGroupMembers.mockResolvedValue([member("new@uni.ca"), member("outgoing@uni.ca")]);

    const kept = await run(db, { retain: ["Outgoing@uni.ca"] });
    expect(kept.stale).toEqual([]);

    listGroupMembers.mockResolvedValue([member("new@uni.ca"), member("outgoing@uni.ca")]);
    const notKept = await run(db);
    expect(notKept.stale).toEqual(["outgoing@uni.ca"]);
  });
});

describe("taking the outgoing directors off", () => {
  it("removes the named people and confirms it by reading the group back", async () => {
    const { db } = stubDb(["stays@uni.ca"]);
    listGroupMembers
      .mockResolvedValueOnce([member("stays@uni.ca"), member("left@uni.ca")])
      .mockResolvedValueOnce([member("stays@uni.ca")]);
    removeGroupMember.mockResolvedValue(undefined);

    const out = await run(db, { remove: ["left@uni.ca"] });
    expect(removeGroupMember).toHaveBeenCalledWith("board@campusstores.ca", "left@uni.ca");
    expect(out.removed).toEqual(["left@uni.ca"]);
    expect(out.stillThere).toEqual([]);
    expect(out.verified).toBe(true);
    const { describeOutcome } = await import("../governance-group");
    expect(describeOutcome(out)).toContain("1 taken off");
  });

  it("⛔ says they are still on the list when the delete returned 200 and changed nothing", async () => {
    const { db } = stubDb(["stays@uni.ca"]);
    // Both reads say the same thing: the delete did nothing.
    listGroupMembers.mockResolvedValue([member("stays@uni.ca"), member("left@uni.ca")]);
    removeGroupMember.mockResolvedValue(undefined);

    const out = await run(db, { remove: ["left@uni.ca"] });
    expect(out.removed).toEqual(["left@uni.ca"]);
    expect(out.stillThere).toEqual(["left@uni.ca"]);
    const { describeOutcome } = await import("../governance-group");
    expect(describeOutcome(out)).toContain("still on the list");
  });

  it("⛔ refuses to remove somebody who still holds the role, whatever the caller says", async () => {
    // The re-elected incumbent. The register outranks the removal list.
    const { db } = stubDb(["incumbent@uni.ca"]);
    listGroupMembers.mockResolvedValue([member("incumbent@uni.ca")]);

    const out = await run(db, { remove: ["incumbent@uni.ca"] });
    expect(removeGroupMember).not.toHaveBeenCalled();
    expect(out.removed).toEqual([]);
    expect(out.leftAlone).toEqual([
      { email: "incumbent@uni.ca", reason: "still holds the role on this body" },
    ]);
    expect(out.stillThere).toEqual([]);
  });

  it("⛔ refuses to remove a manager or an address CSC owns", async () => {
    const { db } = stubDb([]);
    listGroupMembers.mockResolvedValue([
      member("chair@uni.ca", "MANAGER"),
      member("board-forward@campusstores.ca"),
    ]);

    const out = await run(db, { remove: ["chair@uni.ca", "board-forward@campusstores.ca"] });
    expect(removeGroupMember).not.toHaveBeenCalled();
    expect(out.leftAlone.map((l) => l.email).sort()).toEqual([
      "board-forward@campusstores.ca",
      "chair@uni.ca",
    ]);
    expect(out.stillThere).toEqual([]);
  });

  it("says nothing about somebody already off the list", async () => {
    const { db } = stubDb([]);
    listGroupMembers.mockResolvedValue([]);

    const out = await run(db, { remove: ["long-gone@uni.ca"] });
    expect(removeGroupMember).not.toHaveBeenCalled();
    expect(out.removed).toEqual([]);
    expect(out.leftAlone).toEqual([]);
    expect(out.stillThere).toEqual([]);
  });

  it("names the removal that threw, and keeps going", async () => {
    const { db } = stubDb([]);
    listGroupMembers.mockResolvedValue([member("a@uni.ca"), member("b@uni.ca")]);
    removeGroupMember
      .mockRejectedValueOnce(new Error("insufficient permission"))
      .mockResolvedValueOnce(undefined);

    const out = await run(db, { remove: ["a@uni.ca", "b@uni.ca"] });
    expect(removeGroupMember).toHaveBeenCalledTimes(2);
    expect(out.failed).toEqual([
      { email: "a@uni.ca", reason: "insufficient permission", action: "remove" },
    ]);
    expect(out.removed).toEqual(["b@uni.ca"]);
    // The read back still shows both, so both are reported as still on.
    expect(out.stillThere.sort()).toEqual(["a@uni.ca", "b@uni.ca"]);
  });

  it("counts the removals onto the rule's last run", async () => {
    const { db, writes } = stubDb([]);
    listGroupMembers.mockResolvedValueOnce([member("left@uni.ca")]).mockResolvedValueOnce([]);
    removeGroupMember.mockResolvedValue(undefined);

    await run(db, { remove: ["left@uni.ca"] });
    expect(writes[0].last_run).toMatchObject({ queuedRemoves: 1 });
    expect(writes[0].last_run).not.toHaveProperty("error");
  });
});
