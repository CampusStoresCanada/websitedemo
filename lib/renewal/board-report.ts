import { createAdminClient } from "@/lib/supabase/admin";
import { getPartnershipRateCents } from "@/lib/stripe/billing";
import { getRenewalConfig } from "@/lib/policy/engine";
import { getExpectedAmountsByOrg } from "./expected-amounts";
import { getOutreachByOrg, type OrgOutreach } from "./outreach";
import { ORG_TYPE } from "@/lib/constants/org-types";
import type { RenewalOrgType } from "./renewal-progress";

const ORG_TYPES: RenewalOrgType[] = [ORG_TYPE.member, ORG_TYPE.vendorPartner];

/** One organization's standing in the cycle, named so the board can act on it. */
export interface BoardRenewalOrgRow {
  organizationId: string;
  name: string;
  amountCents: number;
  renewedAt: string | null;
  /** Who owns the conversation this cycle, if anyone has been assigned. */
  assignedTo: string | null;
  /** When a human last actually spoke to them — not the reminder cron. */
  lastContactedAt: string | null;
  lastOutcome: string | null;
  contactCount: number;
}

export interface BoardRenewalTypeReport {
  orgType: RenewalOrgType;
  populationCount: number;
  renewedCount: number;
  totalExpectedCents: number;
  collectedCents: number;
  outstandingCents: number;
  /** Named, alphabetical — the call list the board is being asked to divide up. */
  outstanding: BoardRenewalOrgRow[];
  /** Of the outstanding orgs: how many have an owner, and how many have been
   *  spoken to. Coverage is the board-facing measure — it is the part the board
   *  controls, where the paid count is largely the members' decision. */
  assignedCount: number;
  contactedCount: number;
}

export interface BoardRenewalReport {
  renewalYear: number;
  cycleLabel: string;
  generatedAt: string;
  types: Record<RenewalOrgType, BoardRenewalTypeReport>;
  totals: {
    populationCount: number;
    renewedCount: number;
    collectedCents: number;
    outstandingCents: number;
    outstandingCount: number;
    assignedCount: number;
    contactedCount: number;
  };
}

function addMonthsUTC(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * The board reporting window for a meeting, which is deliberately WIDER than
 * `getCurrentRenewalSeason()`.
 *
 * The operational season ends at `cycle_start + grace_days` (1 Oct with today's
 * policy) because that's when the chase stops mattering. But the first board
 * meeting *after* the grace cliff is exactly when "who lapsed, and what did it
 * cost" is finally a settled question — and under the operational window that
 * meeting would show nothing. So the board window runs from one month before
 * the cycle start to three months after it.
 *
 * Keyed on the MEETING date, never on "today": a past meeting's page must keep
 * rendering the tab forever, or minutes end up citing figures that no longer
 * appear anywhere.
 */
export async function resolveBoardRenewalWindow(
  meetingDate: string
): Promise<{ renewalYear: number; cycleStart: Date } | null> {
  const config = await getRenewalConfig();
  const [month, day] = config.cycle_start_month_day.split("-").map(Number);
  const meeting = new Date(`${meetingDate}T00:00:00Z`);
  if (Number.isNaN(meeting.getTime())) return null;

  const meetingYear = meeting.getUTCFullYear();
  for (const year of [meetingYear - 1, meetingYear, meetingYear + 1]) {
    const cycleStart = new Date(Date.UTC(year, month - 1, day));
    const windowStart = addMonthsUTC(cycleStart, -1);
    const windowEnd = addMonthsUTC(cycleStart, 3);
    if (meeting >= windowStart && meeting < windowEnd) {
      // Matches lib/renewal/season.ts and the renewalYear written to
      // renewal_events by the live cron — cycle-start year PLUS ONE.
      return { renewalYear: year + 1, cycleStart };
    }
  }
  return null;
}

async function getTypeReport(
  db: ReturnType<typeof createAdminClient>,
  orgType: RenewalOrgType,
  renewalYear: number
): Promise<BoardRenewalTypeReport> {
  // Population filter is deliberately identical to getTypeProgress() in
  // renewal-progress.ts — the board tab and the /admin widget must never
  // disagree about who is in the denominator.
  const { data: orgs } = await db
    .from("organizations")
    .select("id, name")
    .eq("type", orgType)
    .eq("is_test", false)
    .not("membership_status", "in", "(canceled,applied)")
    .is("archived_at", null);

  const orgRows = orgs ?? [];
  const orgIds = orgRows.map((o) => o.id);

  const empty: BoardRenewalTypeReport = {
    orgType,
    populationCount: 0,
    renewedCount: 0,
    totalExpectedCents: 0,
    collectedCents: 0,
    outstandingCents: 0,
    outstanding: [],
    assignedCount: 0,
    contactedCount: 0,
  };
  if (orgIds.length === 0) return empty;

  // "Renewed" keys off charge_succeeded, NOT invoice status. Renewals arrive by
  // several paths (standalone invoice, dues bundled into a booth checkout, a
  // pre-signup booth payment) and the bundled paths void the standalone invoice
  // rather than paying it. Every path logs charge_succeeded. Verified against a
  // three-path reconstruction on 2026-08-27: identical counts.
  const chargeEventsRes = await db
    .from("renewal_events")
    .select("organization_id, created_at")
    .eq("event_type", "charge_succeeded")
    .eq("renewal_year", renewalYear)
    .in("organization_id", orgIds);

  const renewedAtByOrg = new Map<string, string>();
  for (const row of chargeEventsRes.data ?? []) {
    const existing = renewedAtByOrg.get(row.organization_id);
    if (!existing || row.created_at < existing) {
      renewedAtByOrg.set(row.organization_id, row.created_at);
    }
  }

  const [expectedByOrg, outreachByOrg] = await Promise.all([
    getExpectedAmountsByOrg(db, orgIds, renewalYear),
    getOutreachByOrg(db, orgIds, renewalYear),
  ]);
  const noOutreach: OrgOutreach = { assignedTo: null, lastContact: null, contactCount: 0 };

  // Vendor Partner dues are a flat rate, so this fallback is exact rather than
  // an estimate. Member dues are FTE-tiered with no cheap equivalent, but every
  // active Member already carries an invoice_generated event.
  const partnerFallbackCents =
    orgType === ORG_TYPE.vendorPartner ? await getPartnershipRateCents() : 0;

  const report: BoardRenewalTypeReport = { ...empty, orgType, populationCount: orgRows.length };

  for (const org of orgRows) {
    const expectedCents = expectedByOrg.get(org.id) ?? partnerFallbackCents;
    const renewedAt = renewedAtByOrg.get(org.id) ?? null;

    report.totalExpectedCents += expectedCents;

    if (renewedAt) {
      report.renewedCount++;
      report.collectedCents += expectedCents;
    } else {
      const outreach = outreachByOrg.get(org.id) ?? noOutreach;
      if (outreach.assignedTo) report.assignedCount++;
      if (outreach.lastContact) report.contactedCount++;
      report.outstandingCents += expectedCents;
      report.outstanding.push({
        organizationId: org.id,
        name: org.name,
        amountCents: expectedCents,
        renewedAt: null,
        assignedTo: outreach.assignedTo,
        lastContactedAt: outreach.lastContact?.contactedAt ?? null,
        lastOutcome: outreach.lastContact?.outcome ?? null,
        contactCount: outreach.contactCount,
      });
    }
  }

  report.outstanding.sort((a, b) => a.name.localeCompare(b.name));
  return report;
}

/**
 * Renewal standing for one board meeting. Returns null when the meeting falls
 * outside the board window — the caller should not render the tab at all.
 */
export async function getBoardRenewalReport(
  meetingDate: string
): Promise<BoardRenewalReport | null> {
  const window = await resolveBoardRenewalWindow(meetingDate);
  if (!window) return null;

  const db = createAdminClient();
  const [memberReport, partnerReport] = await Promise.all(
    ORG_TYPES.map((orgType) => getTypeReport(db, orgType, window.renewalYear))
  );

  const types = {
    [ORG_TYPE.member]: memberReport,
    [ORG_TYPE.vendorPartner]: partnerReport,
  } as Record<RenewalOrgType, BoardRenewalTypeReport>;

  const all = [memberReport, partnerReport];
  return {
    renewalYear: window.renewalYear,
    cycleLabel: `${window.cycleStart.getUTCFullYear()}-${String(window.renewalYear).slice(2)}`,
    generatedAt: new Date().toISOString(),
    types,
    totals: {
      populationCount: all.reduce((n, t) => n + t.populationCount, 0),
      renewedCount: all.reduce((n, t) => n + t.renewedCount, 0),
      collectedCents: all.reduce((n, t) => n + t.collectedCents, 0),
      outstandingCents: all.reduce((n, t) => n + t.outstandingCents, 0),
      outstandingCount: all.reduce((n, t) => n + t.outstanding.length, 0),
      assignedCount: all.reduce((n, t) => n + t.assignedCount, 0),
      contactedCount: all.reduce((n, t) => n + t.contactedCount, 0),
    },
  };
}
