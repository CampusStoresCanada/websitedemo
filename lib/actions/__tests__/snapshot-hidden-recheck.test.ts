import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A snapshot is served from /s/[id] with no authentication. Capture-time
 * filtering cannot help someone who asks to be hidden AFTER the snapshot was
 * taken, so the way out has to re-check.
 */

// snapshots.ts pulls in capture.ts -> contacts/directory.ts, which is server-only.
vi.mock("server-only", () => ({}));

let hiddenNames: string[] = [];
let shouldError = false;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        in: () => ({
          eq: async () =>
            shouldError
              ? { data: null, error: { message: "boom" } }
              : { data: hiddenNames.map((name) => ({ name })), error: null },
        }),
      }),
    }),
  }),
}));

const snapshotRow = {
  id: "s1",
  type: "org_profile",
  page_url: "/org/x",
  page_title: "X",
  note: null,
  created_by: "u1",
  recipient_email: null,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  created_at: new Date().toISOString(),
  snapshot: {
    type: "org_profile",
    organization: { id: "o1", name: "X" },
    contacts: [{ name: "Stays Visible" }, { name: "Asked To Be Hidden" }],
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: snapshotRow, error: null }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/auth/guards", () => ({ requireAuthenticated: async () => ({ ok: false }) }));

import { resolveSnapshot } from "../snapshots";

const names = (r: unknown) =>
  ((r as { record?: { snapshot?: { contacts?: { name: string }[] } } }).record
    ?.snapshot?.contacts ?? []).map((c) => c.name);

beforeEach(() => {
  hiddenNames = [];
  shouldError = false;
});

describe("resolveSnapshot hidden re-check", () => {
  it("keeps everyone when nobody has withdrawn", async () => {
    const result = await resolveSnapshot("s1");
    expect(result.valid).toBe(true);
    expect(names(result)).toEqual(["Stays Visible", "Asked To Be Hidden"]);
  });

  it("drops someone who asked to be hidden after capture", async () => {
    hiddenNames = ["Asked To Be Hidden"];
    const result = await resolveSnapshot("s1");
    expect(result.valid).toBe(true);
    expect(names(result)).toEqual(["Stays Visible"]);
  });

  it("fails closed — an unreadable check publishes nobody", async () => {
    shouldError = true;
    const result = await resolveSnapshot("s1");
    expect(names(result)).toEqual([]);
  });
});
