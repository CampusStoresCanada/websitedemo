/**
 * Did anyone actually use the QR codes?
 *
 * A printed directory is otherwise unmeasurable — you find out whether it was
 * worth the money by asking people at the next conference. A scan is the one
 * honest signal that a listing did something, and it is worth knowing before
 * committing to another print run.
 *
 * Recorded into its own table. `activities` looked like the right home — it is
 * the generic event log — but it requires person_id NOT NULL, because it is a
 * per-person engagement feed from Circle. These scans are anonymous hits on a
 * public page, so using it would mean inventing a person for every scan.
 *
 * ── What is deliberately NOT recorded ──────────────────────────────────────
 * No IP address, no raw user-agent, no person_id — even when the scanner is
 * signed in and we could. The question asked was "does this get used", and
 * that is answered by counts. Logging which named member looked at which
 * supplier builds a surveillance trail nobody asked for, out of a public page,
 * and it would be hard to justify to the person scanning. If per-member lead
 * data is ever genuinely wanted, that is a deliberate product decision with
 * its own privacy notice, not a field quietly added here.
 */

import { createAdminClient } from "@/lib/supabase/admin";

/** Coarse device class. Enough to tell phone-in-hand from desk browsing. */
export type ScanDevice = "mobile" | "desktop" | "unknown";

/**
 * How they arrived. The printed QR encodes `?s=p`, so a real print scan is
 * distinguishable from someone following a shared link — which is the whole
 * question when judging whether the paper earned its place.
 */
export type ScanSource = "print" | "link";

const BOT_PATTERN =
  /bot|crawler|spider|crawling|slackbot|discordbot|whatsapp|telegram|preview|facebookexternalhit|embedly|curl|wget|python-requests|headless|lighthouse|pingdom|uptime/i;

/**
 * Link previewers hit these URLs constantly — paste one into Slack and it
 * fetches immediately. Counting those as scans would inflate the only number
 * anyone will use to judge the print run.
 */
export function isBot(userAgent: string | null): boolean {
  if (!userAgent) return true; // no UA at all is a script, not a person
  return BOT_PATTERN.test(userAgent);
}

export function deviceFrom(userAgent: string | null): ScanDevice {
  if (!userAgent) return "unknown";
  return /iphone|ipad|android|mobile/i.test(userAgent) ? "mobile" : "desktop";
}

/**
 * Record one scan. Never throws and never blocks the page — a listing must
 * still render if analytics is down. Losing a count is acceptable; failing to
 * show a member the contact they scanned for is not.
 */
export async function recordDirectoryScan(input: {
  organizationId: string;
  publicCode: string;
  userAgent: string | null;
  source: ScanSource;
}): Promise<void> {
  if (isBot(input.userAgent)) return;
  try {
    await createAdminClient()
      .from("directory_scan_events")
      .insert({
        organization_id: input.organizationId,
        public_code: input.publicCode,
        source: input.source,
        device: deviceFrom(input.userAgent),
      });
  } catch {
    // Deliberately swallowed — see above.
  }
}

export type ScanStats = {
  organizationId: string;
  organizationName: string;
  total: number;
  fromPrint: number;
  lastScanAt: string | null;
};

/** Scan counts per exhibitor, busiest first — "did the book get used". */
export async function loadScanStats(orgIds?: string[]): Promise<ScanStats[]> {
  const db = createAdminClient();
  let q = db
    .from("directory_scan_events")
    .select("organization_id, source, occurred_at, organizations(name)");
  if (orgIds?.length) q = q.in("organization_id", orgIds);

  const { data } = await q;
  const byOrg = new Map<string, ScanStats>();
  for (const row of data ?? []) {
    const orgId = row.organization_id as string | null;
    if (!orgId) continue;
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    const held = byOrg.get(orgId) ?? {
      organizationId: orgId,
      organizationName: (org as { name?: string } | null)?.name ?? "Unknown",
      total: 0,
      fromPrint: 0,
      lastScanAt: null,
    };
    held.total += 1;
    if (row.source === "print") held.fromPrint += 1;
    const at = row.occurred_at as string | null;
    if (at && (!held.lastScanAt || at > held.lastScanAt)) held.lastScanAt = at;
    byOrg.set(orgId, held);
  }
  return [...byOrg.values()].sort((a, b) => b.total - a.total);
}
