import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { method: string; args: unknown[] }[] = [];

function makeQuery() {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "in", "ilike", "is", "or", "limit"]) {
    q[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return q;
    };
  }
  // awaiting the builder resolves the query
  (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [{ id: "c1" }], error: null });
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return makeQuery();
    },
  }),
}));

vi.mock("server-only", () => ({}));

import { listDirectoryContacts } from "../directory";

beforeEach(() => {
  calls.length = 0;
});

const used = (method: string) => calls.filter((c) => c.method === method);

describe("listDirectoryContacts", () => {
  it("excludes people who have left and people who asked not to be listed", async () => {
    await listDirectoryContacts({ organizationIds: ["org-1"] });

    // archived_at is null
    expect(used("is").some((c) => c.args[0] === "archived_at")).toBe(true);
    // hidden is nullable, so "not true" must be spelled out
    expect(
      used("or").some((c) => c.args[0] === "hidden.is.null,hidden.eq.false"),
    ).toBe(true);
  });

  it("can opt back in when a caller genuinely needs everyone", async () => {
    await listDirectoryContacts({
      organizationIds: ["org-1"],
      includeHidden: true,
      includeArchived: true,
    });

    expect(used("is").some((c) => c.args[0] === "archived_at")).toBe(false);
    expect(used("or")).toHaveLength(0);
  });

  it("treats an empty organization list as no organizations, not all of them", async () => {
    const rows = await listDirectoryContacts({ organizationIds: [] });

    expect(rows).toEqual([]);
    // must not have touched the database at all
    expect(calls).toHaveLength(0);
  });

  it("does not filter by organization when none is given", async () => {
    await listDirectoryContacts({ nameSearch: "smith" });

    expect(used("in")).toHaveLength(0);
    expect(used("ilike").some((c) => c.args[1] === "%smith%")).toBe(true);
  });
});
