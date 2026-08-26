import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A snapshot is served from /s/[id] with no authentication. Capture-time
 * filtering cannot help someone who asks to be hidden AFTER the snapshot was
 * taken, so the way out has to re-check.
 */

// snapshots.ts pulls in capture.ts -> contacts/directory.ts, which is server-only.
vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  hiddenNames: [] as string[],
  shouldError: false,
  snapshotRow: {
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
  },
}));

// resolveSnapshot reads BOTH the snapshot and the hidden re-check with the
// service role — anon can no longer select page_snapshots directly, which is
// what forces every read through the expiry and withdrawal checks.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "page_snapshots") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.snapshotRow, error: null }),
            }),
          }),
        };
      }
      // contacts — who has since asked to be hidden
      return {
        select: () => ({
          in: () => ({
            eq: async () =>
              state.shouldError
                ? { data: null, error: { message: "boom" } }
                : { data: state.hiddenNames.map((name) => ({ name })), error: null },
          }),
        }),
      };
    },
  }),
}));

vi.mock("@/lib/auth/guards", () => ({ requireAuthenticated: async () => ({ ok: false }) }));

import { resolveSnapshot } from "../snapshots";

const names = (r: unknown) =>
  ((r as { record?: { snapshot?: { contacts?: { name: string }[] } } }).record
    ?.snapshot?.contacts ?? []).map((c) => c.name);

beforeEach(() => {
  state.hiddenNames = [];
  state.shouldError = false;
});

describe("resolveSnapshot hidden re-check", () => {
  it("keeps everyone when nobody has withdrawn", async () => {
    const result = await resolveSnapshot("s1");
    expect(result.valid).toBe(true);
    expect(names(result)).toEqual(["Stays Visible", "Asked To Be Hidden"]);
  });

  it("drops someone who asked to be hidden after capture", async () => {
    state.hiddenNames = ["Asked To Be Hidden"];
    const result = await resolveSnapshot("s1");
    expect(result.valid).toBe(true);
    expect(names(result)).toEqual(["Stays Visible"]);
  });

  it("fails closed — an unreadable check publishes nobody", async () => {
    state.shouldError = true;
    const result = await resolveSnapshot("s1");
    expect(names(result)).toEqual([]);
  });
});
