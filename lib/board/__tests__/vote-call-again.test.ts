import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Butler asks the board once per application. After a lapse the only way back
 * in front of them is staff pressing "Call the vote again", and it must be a
 * lapse: asking again after a rejection would be overriding the board.
 */

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

import { callVoteAgain } from "@/lib/board/vote-service";

/** The newest vote on the application, and a pending partner application behind it. */
function mockDb(latestVote: { id: string; status: string } | null) {
  const applicationReads: string[] = [];
  const db = {
    applicationReads,
    from(table: string) {
      if (table === "board_votes") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: latestVote }),
        };
        return chain;
      }
      if (table === "signup_applications") {
        applicationReads.push(table);
        const chain = {
          select: () => chain,
          eq: () => chain,
          // Not found: enough to prove the gate was passed and the ordinary
          // opening path took over, without standing up Circle and the roster.
          maybeSingle: async () => ({ data: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return db;
}

beforeEach(() => vi.clearAllMocks());

describe("callVoteAgain", () => {
  it("refuses an application that never had a vote", async () => {
    const db = mockDb(null);
    createAdminClientMock.mockReturnValue(db);

    const result = await callVoteAgain("app-1");

    expect(result.ok).toBe(false);
    expect(db.applicationReads).toHaveLength(0);
  });

  it.each(["open", "carried", "rejected", "withdrawn"])(
    "refuses when the last vote is %s",
    async (status) => {
      const db = mockDb({ id: "vote-1", status });
      createAdminClientMock.mockReturnValue(db);

      const result = await callVoteAgain("app-1");

      expect(result).toEqual({
        ok: false,
        error: `Only a vote that closed with no decision can be called again. This one is ${status}.`,
      });
      // Never reached the code that opens a vote.
      expect(db.applicationReads).toHaveLength(0);
    }
  );

  it("hands a lapsed vote to the ordinary opening path", async () => {
    const db = mockDb({ id: "vote-1", status: "lapsed" });
    createAdminClientMock.mockReturnValue(db);

    const result = await callVoteAgain("app-1");

    // openVoteForApplication ran: it is the one that reads the application.
    expect(db.applicationReads).toHaveLength(1);
    expect(result).toEqual({ ok: false, error: "Application not found" });
  });
});
