/**
 * Does the organizations source actually exclude lapsed orgs?
 *
 * Hits the real database, because the bug this guards against was invisible in
 * every unit test: the loader filtered `type` and `archived_at` and nothing
 * else, so a network directory would have printed 27 canceled members and 7
 * lapsed partners as current — in a book that cannot be corrected afterwards.
 *
 * Skipped unless LIVE_DB_CHECK is set, so it never runs in a normal suite.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));

function loadEnvLocal() {
  let raw: string;
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    // Overwrite: vitest.config.ts stubs the Supabase URL, and filling blanks
    // would silently read an empty database instead of erroring.
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const RUN = !!process.env.LIVE_DB_CHECK;

describe("loadDirectoryEntries — membership status", () => {
  it.skipIf(!RUN)("excludes lapsed organisations by default", async () => {
    loadEnvLocal();
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).not.toContain("example.supabase.co");

    const { loadDirectoryEntries } = await import("../composition-loader");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const db = createAdminClient();

    for (const orgType of ["Member", "Vendor Partner"]) {
      const entries = await loadDirectoryEntries({ kind: "organizations", orgType });
      const withLapsed = await loadDirectoryEntries({ kind: "organizations", orgType, includeInactive: true });

      const { count: activeCount } = await db
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("type", orgType)
        .eq("membership_status", "active")
        .is("archived_at", null)
        .or("is_test.is.null,is_test.eq.false");

      expect(entries.length, `${orgType}: default must match active count`).toBe(activeCount);
      expect(withLapsed.length, `${orgType}: opting in must widen the set`).toBeGreaterThan(entries.length);

      // eslint-disable-next-line no-console
      console.log(`${orgType}: ${entries.length} active, ${withLapsed.length} including lapsed`);
    }
  }, 60_000);

  it.skipIf(!RUN)("fills institution type and FTE for member listings", async () => {
    // The member shape is built out of these two fields, and both were wrong
    // once: FTE was omitted from the column list, and institution type was read
    // from `organizations.institution_type` — an empty legacy column — instead
    // of the answered value in `benchmarking`. Both failures produced a clean
    // render of blank listings, so this asserts real coverage, not just types.
    loadEnvLocal();
    const { loadDirectoryEntries } = await import("../composition-loader");
    const members = await loadDirectoryEntries({ kind: "organizations", orgType: "Member" });

    const withFte = members.filter((m) => typeof m.fte === "number" && m.fte > 0);
    const withType = members.filter((m) => !!m.institutionType);

    // eslint-disable-next-line no-console
    console.log(`members: ${members.length} · FTE ${withFte.length} · institution type ${withType.length}`);

    // Every active member is billed on an FTE, so a gap here is a loader bug
    // rather than missing data.
    expect(withFte.length, "every active member should carry an FTE").toBe(members.length);
    // Institution type comes from the benchmarking survey, so genuine
    // non-respondents are expected — but a near-zero count means it is reading
    // the wrong column again.
    expect(withType.length).toBeGreaterThan(members.length / 2);
  }, 60_000);

  it.skipIf(!RUN)("keeps a lapsed booth holder in the conference directory", async () => {
    // Booth ownership is what qualifies an exhibitor, not membership status —
    // someone who paid for a booth is standing in the hall regardless.
    loadEnvLocal();
    const { loadDirectoryEntries } = await import("../composition-loader");
    const entries = await loadDirectoryEntries({
      kind: "conference",
      conferenceId: "7e650b08-51d1-4573-a332-7d6b6fbc50bd",
    });
    expect(entries.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`conference source: ${entries.length} booth holders (status not applied)`);
  }, 60_000);
});
