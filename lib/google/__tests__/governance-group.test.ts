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

/**
 * A row as the sync now reads it.
 *
 * ⚠️ The query no longer filters by date. It selects every assignment for the
 * role and applies `hasBoardAccessOn` in JS, because the rule is
 * `coalesce(access_from, term_start) <= asOf` and PostgREST cannot express that
 * without a view — and a second hand-written filter is how the list and the
 * board register screen would drift apart. So these stubs carry real dates, and
 * the tests below prove the date behaviour through OUTCOMES rather than by
 * inspecting the query, which is the better test anyway.
 */
interface StubRow {
  email: string | null;
  termStart?: string;
  termEnd?: string | null;
  accessFrom?: string | null;
  accessUntil?: string | null;
  countsTowardCap?: boolean;
}

/** The two reads the sync makes, plus the last_run write it ends with. */
function stubDb(holders: (string | null | StubRow)[]) {
  const writes: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      if (table === "governance_bodies") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "b1" } }) }) }),
        };
      }
      if (table === "governance_role_assignments") {
        const rows = holders.map((h) => {
          const r: StubRow = typeof h === "string" || h === null ? { email: h } : h;
          return {
            person_contact_id: "c",
            // Wide open by default, so a test that says nothing about dates is
            // testing the thing it means to test.
            term_start: r.termStart ?? "2000-01-01",
            term_end: r.termEnd === undefined ? null : r.termEnd,
            access_from: r.accessFrom ?? null,
            access_until: r.accessUntil ?? null,
            counts_toward_cap: r.countsTowardCap ?? true,
            contacts: r.email ? { email: r.email } : null,
          };
        });
        const res = Promise.resolve({ data: rows });
        return { select: () => ({ eq: () => ({ eq: () => res }) }) };
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

  it("⛔ does NOT call a just-added member missing when the read back has not caught up", async () => {
    // ⚠️ This test asserted the opposite until 2026-11-26, and the opposite is
    // what the FIRST real press did: Google's Directory API is eventually
    // consistent, the read-back a second later did not list her, and the run
    // recorded "jackie.nguyen@norquest.ca did not land" — into last_run, where
    // somebody would read it as fact. She was on the list the whole time.
    //
    // The read-back verifies the state this run did not touch. A write is
    // confirmed by its own call returning, and checked by the NEXT run.
    const { db } = stubDb(["a@uni.ca", "new@uni.ca"]);
    // Both reads say the same thing: Google has not listed the add yet.
    listGroupMembers.mockResolvedValue([member("a@uni.ca")]);
    addGroupMember.mockResolvedValue(undefined);

    const out = await run(db);
    expect(out.added).toEqual(["new@uni.ca"]);
    expect(out.missing).toEqual([]);
    const { describeOutcome } = await import("../governance-group");
    expect(describeOutcome(out)).not.toContain("did not land");
    // And it does not claim the add was confirmed either, because it was not.
    expect(describeOutcome(out)).toContain("the next run confirms this one");
  });

  it("⛔ DOES call it missing on a later run, when nothing was written this time", async () => {
    // The genuine add failure, and the only run that can see it: the address is
    // wanted, it is not on the list, and this run wrote nothing — so there is
    // no pending write for it to be waiting on.
    const { db } = stubDb(["a@uni.ca", "ghost@uni.ca"]);
    listGroupMembers.mockResolvedValue([member("a@uni.ca"), member("ghost@uni.ca")]);
    addGroupMember.mockResolvedValue(undefined);
    // First run adds ghost; it is already on the list by the second.
    await run(db);

    listGroupMembers.mockResolvedValue([member("a@uni.ca")]);
    addGroupMember.mockReset();
    addGroupMember.mockRejectedValue(new Error("resource not found"));
    const out = await run(db);
    expect(out.added).toEqual([]);
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
  it("⛔ reasons as of the entered date, not today", async () => {
    // Serves a term that has not begun on the date entered, and one that is
    // over by it. Neither should be wanted; a sync reasoning from `today`
    // would get both wrong.
    const { db } = stubDb([
      { email: "future@uni.ca", termStart: "2029-01-01", termEnd: "2031-01-01" },
      { email: "past@uni.ca", termStart: "2025-01-01", termEnd: "2028-07-14" },
      { email: "serving@uni.ca", termStart: "2027-01-01", termEnd: "2029-01-01" },
    ]);
    listGroupMembers.mockResolvedValue([]);

    const out = await run(db, { asOf: "2028-07-14" });
    expect(out.asOf).toBe("2028-07-14");
    expect(out.wanted).toEqual(["serving@uni.ca"]);
  });

  it("⚠️ term_end is EXCLUSIVE — a term ending on the date is already over", async () => {
    const { db } = stubDb([{ email: "ends@uni.ca", termStart: "2025-01-01", termEnd: "2028-07-14" }]);
    listGroupMembers.mockResolvedValue([member("ends@uni.ca")]);
    const out = await run(db, { asOf: "2028-07-14" });
    expect(out.wanted).toEqual([]);
    // On the list, holding nothing, and never touched for it.
    expect(out.stale).toEqual(["ends@uni.ca"]);
    expect(out.removed).toEqual([]);
  });

  it("⛔ an access window overrides the term at BOTH ends", async () => {
    // Incoming: elected, term starts in January, invited in November.
    // Outgoing: term ended at the meeting, kept on through the conference.
    const { db } = stubDb([
      { email: "incoming@uni.ca", termStart: "2029-01-01", termEnd: "2031-01-01", accessFrom: "2028-07-01" },
      { email: "outgoing@uni.ca", termStart: "2026-01-01", termEnd: "2028-01-01", accessUntil: "2028-09-30" },
    ]);
    listGroupMembers.mockResolvedValue([]);
    const out = await run(db, { asOf: "2028-07-14" });
    expect([...out.wanted].sort()).toEqual(["incoming@uni.ca", "outgoing@uni.ca"]);
  });

  it("⛔ a no-prior-service marker never reaches the list", async () => {
    // Zero-length and non-counting: a statement that somebody has NOT served.
    const { db } = stubDb([
      { email: "marker@uni.ca", termStart: "2026-09-28", termEnd: "2026-09-28", countsTowardCap: false },
    ]);
    listGroupMembers.mockResolvedValue([]);
    const out = await run(db, { asOf: "2028-07-14" });
    expect(out.wanted).toEqual([]);
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

  it("⛔ does NOT say still-on when the delete has not propagated yet", async () => {
    // The removal mirror of the add case above, and wrong for the same reason:
    // the listing taken immediately after a delete still shows the member.
    // Reporting that as "the delete did nothing" is a false record — and on
    // the removal side it is the one that would get somebody taken off twice.
    const { db } = stubDb(["stays@uni.ca"]);
    listGroupMembers.mockResolvedValue([member("stays@uni.ca"), member("left@uni.ca")]);
    removeGroupMember.mockResolvedValue(undefined);

    const out = await run(db, { remove: ["left@uni.ca"] });
    expect(out.removed).toEqual(["left@uni.ca"]);
    expect(out.stillThere).toEqual([]);
    // Nor is it counted as drift off the back of the same stale listing.
    expect(out.stale).toEqual([]);
    const { describeOutcome } = await import("../governance-group");
    expect(describeOutcome(out)).not.toContain("still on the list");
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
    // Only the one that THREW. b went through, and a listing Google has not
    // updated yet is no evidence against it; a threw, so nothing is pending
    // for it and the listing is the whole story.
    expect(out.stillThere).toEqual(["a@uni.ca"]);
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

/**
 * Greg is on board@ three times over — info@, greg@campusstores.ca and
 * greg@mcphersonmanagement.com — because otherwise he says he did not see it.
 * None of that is derivable from the register, so it is declared on the rule.
 * Two of the three are @campusstores.ca and were already safe as CSC's own
 * addresses; the third is an outside domain and is the one these pin.
 */
describe("an address declared as belonging on the list whatever the roster says", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    removeGroupMember.mockResolvedValue(undefined);
  });

  it("⛔ is not reported as drift, so the report does not cry wolf on every run for ever", async () => {
    const { db } = stubDb(["chair@uni.ca"]);
    listGroupMembers.mockResolvedValue([
      member("chair@uni.ca"),
      member("greg@mcphersonmanagement.com"),
    ]);

    const declared = await run(db, { retain: ["greg@mcphersonmanagement.com"] });
    expect(declared.stale).toEqual([]);

    // Undeclared, the same address is drift. The declaration is doing the work,
    // not some incidental filter.
    const { db: db2 } = stubDb(["chair@uni.ca"]);
    const undeclared = await run(db2);
    expect(undeclared.stale).toEqual(["greg@mcphersonmanagement.com"]);
  });

  it("⛔ is refused for removal even when the caller names it", async () => {
    const { db } = stubDb(["chair@uni.ca"]);
    listGroupMembers.mockResolvedValue([
      member("chair@uni.ca"),
      member("greg@mcphersonmanagement.com"),
    ]);

    const out = await run(db, {
      remove: ["greg@mcphersonmanagement.com"],
      retain: ["greg@mcphersonmanagement.com"],
    });

    expect(removeGroupMember).not.toHaveBeenCalled();
    expect(out.removed).toEqual([]);
    expect(out.leftAlone).toEqual([
      {
        email: "greg@mcphersonmanagement.com",
        reason: "declared as belonging on this list whatever the roster says",
      },
    ]);
    // ⚠️ A deliberate refusal is not a failed removal. Counting it here is how
    // every run would read as broken.
    expect(out.stillThere).toEqual([]);
    expect(out.failed).toEqual([]);
  });

  it("is matched however it was typed, since a person entered it by hand", async () => {
    const { db } = stubDb([]);
    listGroupMembers.mockResolvedValue([member("greg@mcphersonmanagement.com")]);

    const out = await run(db, {
      remove: ["GREG@McPhersonManagement.com"],
      retain: ["Greg@MCPHERSONMANAGEMENT.com"],
    });
    expect(removeGroupMember).not.toHaveBeenCalled();
    expect(out.stale).toEqual([]);
  });

  it("still removes the people who really are leaving", async () => {
    const { db } = stubDb(["chair@uni.ca"]);
    listGroupMembers
      .mockResolvedValueOnce([
        member("chair@uni.ca"),
        member("left@uni.ca"),
        member("greg@mcphersonmanagement.com"),
      ])
      .mockResolvedValueOnce([member("chair@uni.ca"), member("greg@mcphersonmanagement.com")]);

    const out = await run(db, {
      remove: ["left@uni.ca", "greg@mcphersonmanagement.com"],
      retain: ["greg@mcphersonmanagement.com"],
    });
    expect(removeGroupMember).toHaveBeenCalledTimes(1);
    expect(removeGroupMember).toHaveBeenCalledWith("board@campusstores.ca", "left@uni.ca");
    expect(out.removed).toEqual(["left@uni.ca"]);
    expect(out.stale).toEqual([]);
  });
});
