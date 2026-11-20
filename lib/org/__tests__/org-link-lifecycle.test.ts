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

import { endOrgLinkForRemovedContact, expireOrgLinks } from "../org-link-lifecycle";

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

/**
 * ⛔ Removing a contact ends their login. It used to end everything else and
 * leave them able to sign in as a member of the store they had left.
 */
describe("endOrgLinkForRemovedContact", () => {
  beforeEach(() => vi.clearAllMocks());

  /** A client holding one org's links and contacts, recording every update. */
  function removalDb(state: {
    links: Array<{ id: string; user_id: string; role: string; status: string }>;
    contacts?: Array<{ id: string; profile_id: string; archived_at: string | null }>;
  }) {
    const updates: Array<{ id: string; status: unknown }> = [];
    const matching = <T extends Record<string, unknown>>(rows: T[], filters: Array<(row: T) => boolean>) =>
      rows.filter((row) => filters.every((f) => f(row)));
    const db = {
      from: (table: string) => ({
        select: (_cols: string, opts?: { head?: boolean }) => {
          const rows = (table === "user_organizations" ? state.links : state.contacts ?? []) as Array<Record<string, unknown>>;
          const filters: Array<(row: Record<string, unknown>) => boolean> = [];
          const chain = {
            eq: (col: string, val: unknown) => (filters.push((r) => !(col in r) || r[col] === val), chain),
            neq: (col: string, val: unknown) => (filters.push((r) => r[col] !== val), chain),
            is: (col: string, val: unknown) => (filters.push((r) => r[col] === val), chain),
            limit: () => Promise.resolve({ data: matching(rows, filters), error: null }),
            maybeSingle: () => Promise.resolve({ data: matching(rows, filters)[0] ?? null, error: null }),
            // The head count is awaited straight off the chain.
            then: (resolve: (v: { count: number }) => unknown) =>
              resolve({ count: opts?.head ? matching(rows, filters).length : 0 }),
          };
          return chain;
        },
        update: (payload: { status: unknown }) => ({
          eq: (_col: string, id: string) => {
            updates.push({ id, status: payload.status });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    return { db: db as never, updates };
  }

  const base = { contactId: "c1", profileId: "u1", orgId: "o1", actorId: "staff" };

  it("switches the login off, with the audit row and no second copy of the switch", async () => {
    const fake = removalDb({ links: [{ id: "l1", user_id: "u1", role: "member", status: "active" }] });
    expect(await endOrgLinkForRemovedContact({ db: fake.db, ...base })).toBe("ended");
    expect(fake.updates).toEqual([{ id: "l1", status: "inactive" }]);
    expect(logAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization_user_deactivated",
        actorId: "staff",
        details: { orgId: "o1", targetUserId: "u1", reason: "contact_removed" },
      })
    );
  });

  it("has nothing to do for a contact who never had a login", async () => {
    const fake = removalDb({ links: [] });
    expect(await endOrgLinkForRemovedContact({ db: fake.db, ...base, profileId: null })).toBe("no_login");
    expect(await endOrgLinkForRemovedContact({ db: fake.db, ...base })).toBe("no_login");
    expect(fake.updates).toEqual([]);
  });

  it("leaves an already inactive login alone", async () => {
    const fake = removalDb({ links: [{ id: "l1", user_id: "u1", role: "member", status: "inactive" }] });
    expect(await endOrgLinkForRemovedContact({ db: fake.db, ...base })).toBe("no_login");
    expect(fake.updates).toEqual([]);
  });

  it("never locks out the person doing the removing", async () => {
    const fake = removalDb({ links: [{ id: "l1", user_id: "u1", role: "org_admin", status: "active" }] });
    expect(await endOrgLinkForRemovedContact({ db: fake.db, ...base, actorId: "u1" })).toBe("kept_own_login");
    expect(fake.updates).toEqual([]);
  });

  it("keeps a login that still belongs to another live contact here", async () => {
    const fake = removalDb({
      links: [{ id: "l1", user_id: "u1", role: "member", status: "active" }],
      contacts: [
        { id: "c1", profile_id: "u1", archived_at: "2026-11-20T15:21:04Z" },
        { id: "c2", profile_id: "u1", archived_at: null },
      ],
    });
    expect(await endOrgLinkForRemovedContact({ db: fake.db, ...base })).toBe("kept_other_contact");
    expect(fake.updates).toEqual([]);
  });

  it("does not count the removed contact, or an archived one, as a reason to keep it", async () => {
    const fake = removalDb({
      links: [{ id: "l1", user_id: "u1", role: "member", status: "active" }],
      contacts: [
        { id: "c1", profile_id: "u1", archived_at: null },
        { id: "c0", profile_id: "u1", archived_at: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(await endOrgLinkForRemovedContact({ db: fake.db, ...base })).toBe("ended");
  });

  it("keeps the last admin's login, as Deactivate does", async () => {
    const fake = removalDb({
      links: [
        { id: "l1", user_id: "u1", role: "org_admin", status: "active" },
        { id: "l2", user_id: "u2", role: "member", status: "active" },
        { id: "l3", user_id: "u3", role: "org_admin", status: "inactive" },
      ],
    });
    expect(await endOrgLinkForRemovedContact({ db: fake.db, ...base })).toBe("kept_last_admin");
    expect(fake.updates).toEqual([]);
  });

  it("ends an admin's login when another admin remains", async () => {
    const fake = removalDb({
      links: [
        { id: "l1", user_id: "u1", role: "org_admin", status: "active" },
        { id: "l2", user_id: "u2", role: "org_admin", status: "active" },
      ],
    });
    expect(await endOrgLinkForRemovedContact({ db: fake.db, ...base })).toBe("ended");
    expect(fake.updates).toEqual([{ id: "l1", status: "inactive" }]);
  });
});
