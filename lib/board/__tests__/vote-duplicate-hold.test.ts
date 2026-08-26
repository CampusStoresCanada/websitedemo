import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Butler must not act on an application that is held for possible-duplicate
 * review.
 *
 * This is the regression that motivated the hold: an existing, already-approved
 * partner re-applied through the booth checkout, the application landed in
 * pending_review like any other, and the hourly cron opened a board vote asking
 * nine directors to admit an organization CSC had been billing for years.
 */

const { createAdminClientMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

type AppRow = {
  id: string;
  duplicate_hold_at: string | null;
  duplicate_cleared_at: string | null;
};

/**
 * Minimal stand-in for the two queries findApplicationsNeedingVote runs:
 * signup_applications (filtered by eq/eq) and board_votes (filtered by in).
 */
function mockDb(apps: AppRow[], votedApplicationIds: string[]) {
  return {
    from(table: string) {
      if (table === "signup_applications") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          then: (resolve: (v: { data: AppRow[] }) => unknown) => resolve({ data: apps }),
        };
        return chain;
      }
      const voteChain = {
        select: () => voteChain,
        in: () => Promise.resolve({ data: votedApplicationIds.map((id) => ({ application_id: id })) }),
      };
      return voteChain;
    },
  };
}

async function findApplicationsNeedingVote() {
  const mod = await import("@/lib/board/vote-service");
  return mod.findApplicationsNeedingVote();
}

describe("findApplicationsNeedingVote — possible-duplicate hold", () => {
  beforeEach(() => {
    vi.resetModules();
    createAdminClientMock.mockReset();
  });

  it("skips an application that is held and not yet cleared", async () => {
    createAdminClientMock.mockReturnValue(
      mockDb(
        [
          { id: "held", duplicate_hold_at: "2026-08-26T14:00:00Z", duplicate_cleared_at: null },
          { id: "clean", duplicate_hold_at: null, duplicate_cleared_at: null },
        ],
        []
      )
    );

    await expect(findApplicationsNeedingVote()).resolves.toEqual(["clean"]);
  });

  it("releases an application once an admin clears the hold", async () => {
    createAdminClientMock.mockReturnValue(
      mockDb(
        [
          {
            id: "cleared",
            duplicate_hold_at: "2026-08-26T14:00:00Z",
            duplicate_cleared_at: "2026-08-26T15:00:00Z",
          },
        ],
        []
      )
    );

    await expect(findApplicationsNeedingVote()).resolves.toEqual(["cleared"]);
  });

  it("returns nothing when every pending application is held", async () => {
    createAdminClientMock.mockReturnValue(
      mockDb(
        [
          { id: "a", duplicate_hold_at: "2026-08-26T14:00:00Z", duplicate_cleared_at: null },
          { id: "b", duplicate_hold_at: "2026-08-26T14:00:00Z", duplicate_cleared_at: null },
        ],
        []
      )
    );

    await expect(findApplicationsNeedingVote()).resolves.toEqual([]);
  });

  it("still excludes applications that already have a vote", async () => {
    createAdminClientMock.mockReturnValue(
      mockDb(
        [
          { id: "voted", duplicate_hold_at: null, duplicate_cleared_at: null },
          { id: "fresh", duplicate_hold_at: null, duplicate_cleared_at: null },
        ],
        ["voted"]
      )
    );

    await expect(findApplicationsNeedingVote()).resolves.toEqual(["fresh"]);
  });

  it("does not ask board_votes about held applications", async () => {
    const inSpy = vi.fn((_column: string, _values: string[]) =>
      Promise.resolve({ data: [] as Array<{ application_id: string }> })
    );
    createAdminClientMock.mockReturnValue({
      from(table: string) {
        if (table === "signup_applications") {
          const chain = {
            select: () => chain,
            eq: () => chain,
            then: (resolve: (v: { data: AppRow[] }) => unknown) =>
              resolve({
                data: [
                  { id: "held", duplicate_hold_at: "2026-08-26T14:00:00Z", duplicate_cleared_at: null },
                  { id: "clean", duplicate_hold_at: null, duplicate_cleared_at: null },
                ],
              }),
          };
          return chain;
        }
        const voteChain = { select: () => voteChain, in: inSpy };
        return voteChain;
      },
    });

    await findApplicationsNeedingVote();

    expect(inSpy).toHaveBeenCalledTimes(1);
    expect(inSpy.mock.calls[0][1]).toEqual(["clean"]);
  });
});
