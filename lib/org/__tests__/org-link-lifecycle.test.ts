import { beforeEach, describe, expect, it, vi } from "vitest";
import { inForceOrgLinkFilter, isOrgLinkInForce } from "../../auth/org-link";

const { createAdminClientMock, enqueueCircleSyncMock, logAuditEventSafeMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  enqueueCircleSyncMock: vi.fn(),
  logAuditEventSafeMock: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/circle/sync", () => ({ enqueueCircleSync: enqueueCircleSyncMock }));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: logAuditEventSafeMock }));

import { expireOrgLinks } from "../org-link-lifecycle";

/**
 * ⛔ A person's link to an organisation can end on a date, EXCLUSIVE: a temp
 * whose link ends 2027-02-05 is in through the 4th and out on the 5th.
 */
describe("whether a link is in force", () => {
  it("keeps a link with no end date, which is everybody but temps", () => {
    expect(isOrgLinkInForce({ expires_at: null }, "2027-02-05")).toBe(true);
  });

  it("keeps a link through the day before it ends", () => {
    expect(isOrgLinkInForce({ expires_at: "2027-02-05" }, "2027-02-04")).toBe(true);
  });

  it("drops it from the start of its end date", () => {
    expect(isOrgLinkInForce({ expires_at: "2027-02-05" }, "2027-02-05")).toBe(false);
  });

  it("asks the database the same question", () => {
    expect(inForceOrgLinkFilter("2027-02-05")).toBe("expires_at.is.null,expires_at.gt.2027-02-05");
  });
});

/** A client that records the expiry read's filters and every update. */
function fakeDb(links: Array<{ id: string; user_id: string; organization_id: string }>, failId?: string) {
  const filters: Record<string, unknown> = {};
  const updates: Array<{ id: string; status: unknown }> = [];
  const db = {
    from: () => ({
      select: () => {
        const chain = {
          eq: (col: string, val: unknown) => ((filters[`eq:${col}`] = val), chain),
          lte: (col: string, val: unknown) => {
            filters[`lte:${col}`] = val;
            return Promise.resolve({ data: links, error: null });
          },
        };
        return chain;
      },
      update: (payload: { status: unknown }) => ({
        eq: (_col: string, id: string) => {
          if (id === failId) return Promise.resolve({ error: { message: "nope" } });
          updates.push({ id, status: payload.status });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return { db, filters, updates };
}

describe("expireOrgLinks (nightly)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads only active links whose end date has come", async () => {
    const fake = fakeDb([]);
    createAdminClientMock.mockReturnValue(fake.db);
    await expireOrgLinks(new Date("2027-02-05T08:00:00Z"));
    expect(fake.filters).toEqual({ "eq:status": "active", "lte:expires_at": "2027-02-05" });
  });

  it("switches each one off the same way Deactivate does, without the email", async () => {
    const fake = fakeDb([
      { id: "l1", user_id: "u1", organization_id: "o1" },
      { id: "l2", user_id: "u2", organization_id: "o1" },
    ]);
    createAdminClientMock.mockReturnValue(fake.db);

    const result = await expireOrgLinks(new Date("2027-02-05T08:00:00Z"));

    expect(result).toEqual({ expired: 2, failed: 0, errors: [] });
    expect(fake.updates).toEqual([
      { id: "l1", status: "inactive" },
      { id: "l2", status: "inactive" },
    ]);
    expect(enqueueCircleSyncMock).toHaveBeenCalledTimes(2);
    expect(logAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "system", details: expect.objectContaining({ reason: "expired" }) })
    );
  });

  it("counts a failure and carries on with the rest", async () => {
    const fake = fakeDb(
      [
        { id: "l1", user_id: "u1", organization_id: "o1" },
        { id: "l2", user_id: "u2", organization_id: "o1" },
      ],
      "l1"
    );
    createAdminClientMock.mockReturnValue(fake.db);

    const result = await expireOrgLinks(new Date("2027-02-05T08:00:00Z"));

    expect(result.expired).toBe(1);
    expect(result.failed).toBe(1);
    expect(fake.updates).toEqual([{ id: "l2", status: "inactive" }]);
  });
});
