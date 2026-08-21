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

/**
 * Did the book get used?
 *
 * This exists for one decision: whether printing again is worth the money. It
 * is deliberately not an exhibitor-facing metric — nobody is being told how
 * popular their listing was, and the shape of this data reflects that.
 *
 * The three numbers that answer it:
 *  - `printScans` — scans off paper (`?s=p`), as opposed to forwarded links.
 *    This is the only figure attributable to the print run itself.
 *  - `listingsScanned` of `listingsPrinted` — thirty scans across twenty
 *    listings says the book is being used; thirty across two says one
 *    exhibitor put the QR on their booth banner.
 *  - `byMonth` — a spike in conference week and nothing after means it was a
 *    four-day handout. Activity in April is the case for printing again.
 */
export type PrintUsage = {
  totalScans: number;
  printScans: number;
  linkScans: number;
  mobileScans: number;
  /** Distinct listings that got at least one scan. */
  listingsScanned: number;
  /** Listings in the book, for the denominator. */
  listingsPrinted: number;
  firstScanAt: string | null;
  lastScanAt: string | null;
  /** "2027-02" → scan count, ascending. The staying-power question. */
  byMonth: Array<{ month: string; scans: number }>;
  /** Busiest listings — whether use is broad or concentrated, not a leaderboard. */
  topListings: Array<{ organizationName: string; scans: number }>;
};

/**
 * Usage of the printed directory as a whole.
 *
 * `listingsPrinted` is passed in rather than derived: what matters is the
 * denominator of the book that actually went to press, which the caller knows
 * and this table does not.
 */
export async function loadPrintUsage(listingsPrinted: number): Promise<PrintUsage> {
  const db = createAdminClient();
  const { data } = await db
    .from("directory_scan_events")
    .select("organization_id, source, device, occurred_at, organizations(name)")
    .order("occurred_at", { ascending: true });

  const rows = data ?? [];
  const byOrg = new Map<string, { name: string; scans: number }>();
  const byMonth = new Map<string, number>();
  let printScans = 0;
  let mobileScans = 0;

  for (const row of rows) {
    if (row.source === "print") printScans += 1;
    if (row.device === "mobile") mobileScans += 1;

    const orgId = row.organization_id as string | null;
    if (orgId) {
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      const held = byOrg.get(orgId) ?? { name: (org as { name?: string } | null)?.name ?? "Unknown", scans: 0 };
      held.scans += 1;
      byOrg.set(orgId, held);
    }

    const at = row.occurred_at as string | null;
    if (at) {
      const month = at.slice(0, 7); // YYYY-MM
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
  }

  const occurredAt = rows.map((r) => r.occurred_at as string | null).filter((v): v is string => !!v);

  return {
    totalScans: rows.length,
    printScans,
    linkScans: rows.length - printScans,
    mobileScans,
    listingsScanned: byOrg.size,
    listingsPrinted,
    firstScanAt: occurredAt[0] ?? null,
    lastScanAt: occurredAt.at(-1) ?? null,
    byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, scans]) => ({ month, scans })),
    topListings: [...byOrg.values()].sort((a, b) => b.scans - a.scans).slice(0, 10)
      .map((o) => ({ organizationName: o.name, scans: o.scans })),
  };
}
