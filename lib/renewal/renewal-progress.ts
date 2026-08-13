import { createAdminClient } from "@/lib/supabase/admin";
import { getPartnershipRateCents } from "@/lib/stripe/billing";
import { parseUTC } from "@/lib/utils";
import { getCurrentRenewalSeason } from "./season";

export type RenewalOrgType = "Member" | "Vendor Partner";

const ORG_TYPES: RenewalOrgType[] = ["Member", "Vendor Partner"];

export interface RenewalTypeProgress {
  orgType: RenewalOrgType;
  populationCount: number;
  renewedCount: number;
  totalExpectedCents: number;
  collectedCents: number;
  isComplete: boolean;
  /** One entry per day, seasonStart..today inclusive, zero-filled. */
  dailyRenewalCounts: { date: string; count: number }[];
}

export interface RenewalProgressData {
  renewalYear: number;
  seasonStart: string;
  types: Record<RenewalOrgType, RenewalTypeProgress>;
}

function toDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDailySeries(seasonStart: Date, today: Date, renewalDays: string[]): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const day of renewalDays) {
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const series: { date: string; count: number }[] = [];
  const cursor = new Date(Date.UTC(seasonStart.getUTCFullYear(), seasonStart.getUTCMonth(), seasonStart.getUTCDate()));
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  while (cursor.getTime() <= end.getTime()) {
    const key = toDayString(cursor);
    series.push({ date: key, count: counts.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return series;
}

async function getTypeProgress(
  db: ReturnType<typeof createAdminClient>,
  orgType: RenewalOrgType,
  renewalYear: number,
  seasonStart: Date,
  today: Date
): Promise<RenewalTypeProgress> {
  const { data: orgs } = await db
    .from("organizations")
    .select("id")
    .eq("type", orgType)
    .eq("is_test", false)
    .not("membership_status", "in", "(canceled,applied)")
    .is("archived_at", null);

  const orgIds = (orgs ?? []).map((o) => o.id);

  if (orgIds.length === 0) {
    return {
      orgType,
      populationCount: 0,
      renewedCount: 0,
      totalExpectedCents: 0,
      collectedCents: 0,
      isComplete: false,
      dailyRenewalCounts: buildDailySeries(seasonStart, today, []),
    };
  }

  // "Renewed" has to be keyed off charge_succeeded, not invoice status —
  // renewals happen via at least two independent paths (the standalone
  // reminder/auto-charge cron in lib/renewal/jobs.ts, and a partnership/
  // membership renewal bundled into a conference/booth checkout). An org
  // that renews via the bundled path gets its *standalone* invoice voided
  // (to avoid double-billing) and may never get an invoice_generated event
  // at all — but both paths reliably log charge_succeeded for the same
  // renewal_year, confirmed against production data (every org whose
  // membership_expires_at already covers this renewal year has a matching
  // charge_succeeded event, and vice versa). invoice_generated is used only
  // as a best-effort source for the per-org dues amount, not as the renewal
  // signal itself.
  const [chargeEventsRes, invoiceEventsRes] = await Promise.all([
    db
      .from("renewal_events")
      .select("organization_id, created_at")
      .eq("event_type", "charge_succeeded")
      .eq("renewal_year", renewalYear)
      .in("organization_id", orgIds),
    db
      .from("renewal_events")
      .select("organization_id, invoice_id")
      .eq("event_type", "invoice_generated")
      .eq("renewal_year", renewalYear)
      .in("organization_id", orgIds),
  ]);

  // Earliest charge_succeeded per org — an org shouldn't have more than one,
  // but a retry could in principle log a second.
  const renewedAtByOrg = new Map<string, string>();
  for (const row of chargeEventsRes.data ?? []) {
    const existing = renewedAtByOrg.get(row.organization_id);
    if (!existing || row.created_at < existing) {
      renewedAtByOrg.set(row.organization_id, row.created_at);
    }
  }

  const invoiceIdByOrg = new Map<string, string>();
  for (const row of invoiceEventsRes.data ?? []) {
    if (row.invoice_id) invoiceIdByOrg.set(row.organization_id, row.invoice_id);
  }

  const invoiceIds = Array.from(new Set(invoiceIdByOrg.values()));
  const amountByInvoiceId = new Map<string, number>();
  if (invoiceIds.length > 0) {
    const { data: invoices } = await db.from("invoices").select("id, amount_cents").in("id", invoiceIds);
    for (const inv of invoices ?? []) {
      amountByInvoiceId.set(inv.id, inv.amount_cents);
    }
  }

  // Flat-rate fallback for orgs with no invoice_generated event yet (renewed
  // entirely through a bundled conference/booth checkout, or not yet
  // invoiced at all) — Vendor Partner dues are a flat rate, so this is
  // exact, not an estimate. There's no equivalent cheap fallback for Member
  // dues (FTE-tiered via the policy pricing engine, which persists a DB row
  // when invoked) — in practice every active Member already has an
  // invoice_generated event, so this only matters for Vendor Partner.
  const partnerFallbackCents = orgType === "Vendor Partner" ? await getPartnershipRateCents() : 0;

  let totalExpectedCents = 0;
  let collectedCents = 0;
  let renewedCount = 0;
  const renewalDays: string[] = [];

  for (const orgId of orgIds) {
    const invoiceId = invoiceIdByOrg.get(orgId);
    const expectedCents = (invoiceId ? amountByInvoiceId.get(invoiceId) : undefined) ?? partnerFallbackCents;
    const renewedAt = renewedAtByOrg.get(orgId);

    totalExpectedCents += expectedCents;

    if (renewedAt) {
      renewedCount++;
      collectedCents += expectedCents;
      renewalDays.push(toDayString(parseUTC(renewedAt)));
    }
  }

  return {
    orgType,
    populationCount: orgIds.length,
    renewedCount,
    totalExpectedCents,
    collectedCents,
    isComplete: orgIds.length > 0 && renewedCount === orgIds.length,
    dailyRenewalCounts: buildDailySeries(seasonStart, today, renewalDays),
  };
}

/**
 * Aggregated renewal-season progress for the glanceable admin dashboard
 * widget. Returns null outside a renewal season — the caller should render
 * nothing in that case.
 */
export async function getRenewalProgressData(): Promise<RenewalProgressData | null> {
  const today = new Date();
  const season = await getCurrentRenewalSeason(today);
  if (!season) return null;

  const db = createAdminClient();

  const [memberProgress, partnerProgress] = await Promise.all(
    ORG_TYPES.map((orgType) => getTypeProgress(db, orgType, season.renewalYear, season.seasonStart, today))
  );

  return {
    renewalYear: season.renewalYear,
    seasonStart: toDayString(season.seasonStart),
    types: {
      Member: memberProgress,
      "Vendor Partner": partnerProgress,
    },
  };
}
