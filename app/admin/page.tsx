import Link from "next/link";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONFERENCE_STATUS_LABELS, type ConferenceStatus } from "@/lib/constants/conference";
import { getLatestFinancialSummary } from "@/lib/quickbooks/reports";
import { getRenewalProgressData } from "@/lib/renewal/renewal-progress";
import { getConferenceDashboardStats } from "@/lib/conference/dashboard-stats";
import { getBoardDashboardStats } from "@/lib/board/dashboard-stats";
import { getBoardChecklist } from "@/lib/board/checklist";
import { getDashboardWidgetLayout } from "@/lib/admin/dashboard-widgets";
import { ORG_TYPE } from "@/lib/constants/org-types";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import SyncNowButton from "@/components/admin/board/SyncNowButton";
import OneDriveSetupCard from "@/components/admin/board/OneDriveSetupCard";
import { MembershipRenewalsWidget } from "@/components/admin/MembershipRenewalsWidget";
import { ConferenceWidget } from "@/components/admin/ConferenceWidget";
import { BoardWidget } from "@/components/admin/BoardWidget";
import { BoardChecklist } from "@/components/admin/board/BoardChecklist";

export const metadata = {
  title: "Admin Console | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OPS_STATUSES = new Set(["active", "scheduling", "registration_closed", "registration_open"]);
const RENEWAL_WINDOW_DAYS = 60;

// ─── Small shared UI ────────────────────────────────────────────────

function ConferenceStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft:                "bg-gray-100 text-gray-600",
    registration_open:    "bg-green-100 text-green-700",
    registration_closed:  "bg-yellow-100 text-yellow-700",
    scheduling:           "bg-blue-100 text-blue-700",
    active:               "bg-purple-100 text-purple-700",
    completed:            "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-600"}`}>
      {CONFERENCE_STATUS_LABELS[status as ConferenceStatus] ?? status}
    </span>
  );
}

function MemberStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active:      "bg-green-100 text-green-700",
    reactivated: "bg-green-100 text-green-700",
    grace:       "bg-amber-100 text-amber-700",
    locked:      "bg-red-100 text-red-600",
    approved:    "bg-blue-100 text-blue-700",
    applied:     "bg-gray-100 text-gray-600",
    canceled:    "bg-gray-100 text-gray-400",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

function QuickLink({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
        primary
          ? "border-accent bg-accent text-white hover:bg-accent-hover"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {label}
    </Link>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
      {children}
    </h2>
  );
}

// ─── Nav section data (bottom sitemap) ──────────────────────────────

const NAV_SECTIONS = [
  {
    heading: "Conference",
    items: [
      { href: "/admin/conference",  title: "Conferences",        description: "Manage conference instances, registrations, scheduling, and commerce." },
    ],
  },
  {
    heading: "Membership",
    items: [
      { href: "/admin/membership",  title: "Members & Partners", description: "Organization directory, billing, renewals, and benchmarking." },
      { href: "/admin/applications",title: "Applications",       description: "Review pending membership and partner applications." },
      { href: "/admin/people",      title: "People",             description: "User accounts, contacts, and organizational roles." },
    ],
  },
  {
    heading: "Board",
    items: [
      { href: "/admin/board/meetings",   title: "Board Meetings",   description: "Meeting records and synced documents from OneDrive." },
      { href: "/admin/board/financials", title: "Board Financials", description: "QuickBooks P&L and Balance Sheet snapshots for directors." },
    ],
  },
  {
    heading: "Sponsorships",
    items: [
      { href: "/admin/sponsorships",title: "Sponsorships",       description: "Manage sponsorship tiers, agreements, and placements." },
    ],
  },
  {
    heading: "Communications",
    items: [
      { href: "/admin/comms",       title: "Campaigns & Templates", description: "Manage email campaigns, templates, and delivery analytics." },
      { href: "/admin/events",      title: "Events",             description: "Create, review, and manage non-conference events." },
      { href: "/admin/contact",     title: "Contact Inquiries",  description: "Inbound contact form submissions, including IDN requests." },
    ],
  },
  {
    heading: "System",
    items: [
      { href: "/admin/ops",         title: "Ops Health",         description: "Monitor job status, alerts, webhooks, and integration sync." },
      { href: "/admin/calendar",    title: "Operational Calendar", description: "Unified timeline of conference, renewal, comms, and system milestones." },
    ],
  },
  {
    heading: "Configuration",
    items: [
      { href: "/admin/policy",      title: "Policy Settings",    description: "Review and publish policy changes for billing, scheduling, and retention." },
      { href: "/admin/circle",      title: "Circle Integration", description: "SSO cutover controls, member mapping, and sync status." },
      { href: "/admin/content",     title: "Site Content",       description: "Manage board/staff listings and public website content." },
      { href: "/admin/pages",       title: "Pages & Permissions",description: "Review route ownership, visibility, and permission requirements." },
    ],
  },
];

// ─── Page ────────────────────────────────────────────────────────────

export default async function AdminConsolePage() {
  const auth = await requireAdmin();
  const isSA = auth.ok && isSuperAdmin(auth.ctx.globalRole);

  const db = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const renewalCutoff = new Date();
  renewalCutoff.setDate(renewalCutoff.getDate() + RENEWAL_WINDOW_DAYS);
  const renewalCutoffStr = renewalCutoff.toISOString().slice(0, 10);

  const [
    conferenceResult,
    appCountResult,
    alertCountResult,
    orgsResult,
    sponsorResult,
    eventsResult,
    campaignsResult,
    nextMeetingResult,
    driveSettingsResult,
    financials,
    renewalProgress,
    conferenceStats,
    widgetLayout,
    boardStats,
    boardChecklist,
  ] = await Promise.all([
    // Current conference
    db.from("conference_instances")
      .select("id, name, year, edition_code, status")
      .not("status", "in", "(archived,completed)")
      .order("year", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Pending applications
    db.from("signup_applications")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "pending_review", "pending_verification"]),

    // Open ops alerts
    db.from("ops_alerts")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),

    // All active orgs — small table, group in JS
    db.from("organizations")
      .select("id, name, type, membership_status, membership_expires_at")
      .not("membership_status", "in", "(canceled,applied)")
      .is("archived_at", null)
      .order("membership_expires_at", { ascending: true }),

    // Active + draft sponsor agreements with tier
    db.from("sponsor_agreements")
      .select("id, status, org_id, tier:sponsor_tiers(id, name, color)")
      .in("status", ["active", "draft"])
      .order("status"),

    // Upcoming published events
    db.from("events")
      .select("id, title, starts_at, status")
      .eq("status", "published")
      .gte("starts_at", today)
      .order("starts_at", { ascending: true })
      .limit(4),

    // Recent campaigns
    db.from("message_campaigns")
      .select("id, name, status, sent_at, completed_at, message_deliveries(count)")
      .in("status", ["completed", "sending", "scheduled", "draft"])
      .order("created_at", { ascending: false })
      .limit(4),

    // Next board meeting
    db.from("board_meetings")
      .select("id, meeting_date, status")
      .gte("meeting_date", today)
      .eq("status", "upcoming")
      .order("meeting_date", { ascending: true })
      .limit(1)
      .maybeSingle(),

    // OneDrive drive config
    db.from("app_settings")
      .select("key, value")
      .in("key", ["onedrive_drive_id"]),

    // Latest QBO financial snapshot
    getLatestFinancialSummary(),

    // Renewal-season progress widget — null outside a season
    getRenewalProgressData(),

    // Conference sales widget — null when no live conference
    getConferenceDashboardStats(),

    // Widget order / visibility, per role
    getDashboardWidgetLayout(auth.ok ? auth.ctx.globalRole : "admin"),

    // Board governance health widget
    getBoardDashboardStats(),

    // Board action-item checklist
    getBoardChecklist(auth.ok ? auth.ctx.userId : null),
  ]);

  const conf         = conferenceResult.data;
  const appCount     = appCountResult.count ?? 0;
  const alertCount   = alertCountResult.count ?? 0;
  const allOrgs      = orgsResult.data ?? [];
  const isOpsActive  = conf ? OPS_STATUSES.has(conf.status) : false;
  const nextMeeting  = nextMeetingResult.data;

  const driveConfigured = (driveSettingsResult.data ?? []).some(
    (r) => r.key === "onedrive_drive_id" && r.value
  );

  function fmtCurrency(n: number | null): string {
    if (n === null) return "—";
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
  }

  // ── Membership stats ─────────────────────────────────────────────
  const memberOrgs  = allOrgs.filter((o) => o.type === ORG_TYPE.member);
  const partnerOrgs = allOrgs.filter((o) => o.type === ORG_TYPE.vendorPartner);

  const countByStatus = (orgs: typeof allOrgs, status: string) =>
    orgs.filter((o) => o.membership_status === status).length;

  const activeMembers  = allOrgs.filter((o) =>
    o.membership_status === "active" || o.membership_status === "reactivated"
  ).length;

  const graceMembers = allOrgs.filter((o) => o.membership_status === "grace").length;
  const lockedMembers = allOrgs.filter((o) => o.membership_status === "locked").length;

  // Upcoming renewals — expires between today and cutoff, not already canceled/locked
  const upcomingRenewals = allOrgs
    .filter((o) =>
      o.membership_expires_at &&
      o.membership_expires_at >= today &&
      o.membership_expires_at <= renewalCutoffStr &&
      (o.membership_status === "active" || o.membership_status === "reactivated" || o.membership_status === "grace")
    )
    .slice(0, 6);

  // ── Sponsorship stats ─────────────────────────────────────────────
  type AgreementRow = {
    id: string;
    status: string;
    org_id: string;
    tier: { id: string; name: string; color: string } | null;
  };
  const agreements    = (sponsorResult.data ?? []) as unknown as AgreementRow[];
  const activeAgreements = agreements.filter((a) => a.status === "active");
  const draftAgreements  = agreements.filter((a) => a.status === "draft");

  // Group active by tier
  const tierMap: Record<string, { name: string; color: string; count: number }> = {};
  for (const a of activeAgreements) {
    if (!a.tier) continue;
    if (!tierMap[a.tier.id]) tierMap[a.tier.id] = { name: a.tier.name, color: a.tier.color, count: 0 };
    tierMap[a.tier.id].count++;
  }
  const tierGroups = Object.values(tierMap).sort((a, b) => b.count - a.count);

  // ── Events ───────────────────────────────────────────────────────
  type EventRow = { id: string; title: string; starts_at: string; status: string };
  const upcomingEvents = (eventsResult.data ?? []) as EventRow[];

  // ── Campaigns ────────────────────────────────────────────────────
  type CampaignRow = {
    id: string;
    name: string;
    status: string;
    sent_at: string | null;
    completed_at: string | null;
    message_deliveries: Array<{ count: number }> | number;
  };
  const recentCampaigns = (campaignsResult.data ?? []) as unknown as CampaignRow[];

  function deliveryCount(c: CampaignRow): number {
    if (typeof c.message_deliveries === "number") return c.message_deliveries;
    if (Array.isArray(c.message_deliveries)) return c.message_deliveries[0]?.count ?? 0;
    return 0;
  }

  const campaignStatusColors: Record<string, string> = {
    draft:     "bg-gray-100 text-gray-600",
    scheduled: "bg-blue-100 text-blue-700",
    sending:   "bg-yellow-100 text-yellow-700",
    completed: "bg-green-100 text-green-700",
    failed:    "bg-red-100 text-red-600",
    canceled:  "bg-gray-100 text-gray-400",
  };

  // ── Board meeting countdown ───────────────────────────────────────
  function daysUntil(dateStr: string): number {
    const t = new Date(dateStr + "T00:00:00Z");
    const n = new Date(); n.setUTCHours(0, 0, 0, 0);
    return Math.ceil((t.getTime() - n.getTime()) / 86_400_000);
  }
  const daysToMeeting = nextMeeting ? daysUntil(nextMeeting.meeting_date) : null;

  return (
    <main>
      <AdminPageHeader title="Admin Console" />

      {/* ── Stat strip ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {/* Active members */}
        <Link href="/admin/membership" className={`rounded-xl border bg-white p-4 hover:border-gray-300 transition-colors ${graceMembers > 0 || lockedMembers > 0 ? "border-amber-200" : "border-gray-200"}`}>
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Active Members</div>
          <div className="text-3xl font-bold text-gray-900">{activeMembers}</div>
          <div className="mt-1 text-sm text-gray-500">
            {graceMembers > 0 && <span className="text-amber-600 font-medium">{graceMembers} in grace</span>}
            {graceMembers > 0 && lockedMembers > 0 && " · "}
            {lockedMembers > 0 && <span className="text-red-600 font-medium">{lockedMembers} locked</span>}
            {graceMembers === 0 && lockedMembers === 0 && <span className="text-green-600">all in good standing</span>}
          </div>
        </Link>

        {/* Pending applications */}
        <Link href="/admin/applications" className={`rounded-xl border bg-white p-4 hover:border-gray-300 transition-colors ${appCount > 0 ? "border-amber-300" : "border-gray-200"}`}>
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Pending Applications</div>
          <div className={`text-3xl font-bold ${appCount > 0 ? "text-amber-600" : "text-gray-300"}`}>{appCount}</div>
          <div className="mt-1 text-sm text-gray-500">{appCount === 1 ? "awaiting review" : "awaiting review"}</div>
        </Link>

        {/* Active sponsors */}
        <Link href="/admin/sponsorships" className={`rounded-xl border bg-white p-4 hover:border-gray-300 transition-colors ${draftAgreements.length > 0 ? "border-amber-200" : "border-gray-200"}`}>
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Active Sponsors</div>
          <div className="text-3xl font-bold text-gray-900">{activeAgreements.length}</div>
          <div className="mt-1 text-sm text-gray-500">
            {draftAgreements.length > 0
              ? <span className="text-amber-600 font-medium">{draftAgreements.length} draft{draftAgreements.length !== 1 ? "s" : ""} pending</span>
              : "across all tiers"}
          </div>
        </Link>

        {/* Open alerts */}
        <Link href="/admin/ops" className={`rounded-xl border bg-white p-4 hover:border-gray-300 transition-colors ${alertCount >= 3 ? "border-red-300" : alertCount > 0 ? "border-amber-300" : "border-gray-200"}`}>
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Open Alerts</div>
          <div className={`text-3xl font-bold ${alertCount >= 3 ? "text-red-600" : alertCount > 0 ? "text-amber-600" : "text-gray-300"}`}>{alertCount}</div>
          <div className="mt-1 text-sm text-gray-500">{alertCount === 0 ? "system healthy" : alertCount === 1 ? "needs attention" : "need attention"}</div>
        </Link>
      </div>

      {/* ── Glanceable widgets ───────────────────────────────────── */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-6">
        {widgetLayout.map((key) => {
          if (key === "membership") {
            return renewalProgress
              ? <MembershipRenewalsWidget key={key} data={renewalProgress} />
              : null;
          }
          if (key === "conference") {
            return conferenceStats
              ? <ConferenceWidget key={key} data={conferenceStats} />
              : null;
          }
          if (key === "board") {
            return <BoardWidget key={key} data={boardStats} />;
          }
          return null;
        })}
      </div>

      {/* ── Board action items — full width, it is a list not a tile ── */}
      {widgetLayout.includes("board_checklist") && boardChecklist.rows.length > 0 && (
        <div className="mb-8">
          <BoardChecklist data={boardChecklist} />
        </div>
      )}

      {/* ── Conference quick access ─────────────────────────────── */}
      {conf && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              {conf.name}
              <ConferenceStatusBadge status={conf.status} />
            </h2>
            <Link href={`/admin/conference/${conf.id}/overview`} className="text-xs text-accent hover:underline">
              All sections →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {isOpsActive ? (
              <>
                <QuickLink href={`/admin/conference/${conf.id}/war-room`}      label="War Room"      primary />
                <QuickLink href={`/admin/conference/${conf.id}/registrations`} label="Registrations" />
                <QuickLink href={`/admin/conference/${conf.id}/badges`}        label="Badge Ops"     />
                <QuickLink href={`/admin/conference/${conf.id}/schedule-ops`}  label="Schedule Ops"  />
                <QuickLink href={`/admin/conference/${conf.id}/travel-import`} label="Travel Import" />
              </>
            ) : (
              <>
                <QuickLink href={`/admin/conference/${conf.id}/overview`}      label="Overview"      />
                <QuickLink href={`/admin/conference/${conf.id}/setup`}         label="Schedule Design"/>
                <QuickLink href={`/admin/conference/${conf.id}/products`}      label="Products"      />
                <QuickLink href={`/admin/conference/${conf.id}/registrations`} label="Registrations" />
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Membership health ───────────────────────────────────── */}
      <div className="mb-6">
        <SectionHeading>Membership Health</SectionHeading>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          {/* Status counts */}
          <div className="grid grid-cols-2 gap-6 mb-5">
            {[
              { label: "Members",  orgs: memberOrgs },
              { label: "Partners", orgs: partnerOrgs },
            ].map(({ label, orgs }) => (
              <div key={label}>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
                <div className="flex flex-wrap gap-3">
                  {[
                    { status: "active",      count: countByStatus(orgs, "active") + countByStatus(orgs, "reactivated") },
                    { status: "grace",       count: countByStatus(orgs, "grace") },
                    { status: "locked",      count: countByStatus(orgs, "locked") },
                    { status: "approved",    count: countByStatus(orgs, "approved") },
                  ].map(({ status, count }) =>
                    count > 0 ? (
                      <div key={status} className="flex items-center gap-1.5">
                        <span className="text-lg font-bold text-gray-900">{count}</span>
                        <MemberStatusBadge status={status} />
                      </div>
                    ) : null
                  )}
                  {orgs.length === 0 && <span className="text-sm text-gray-400">None</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Upcoming renewals */}
          {upcomingRenewals.length > 0 && (
            <>
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Renewing in next {RENEWAL_WINDOW_DAYS} days
                </p>
                <div className="space-y-1.5">
                  {upcomingRenewals.map((org) => {
                    const days = daysUntil(org.membership_expires_at!);
                    return (
                      <div key={org.id} className="flex items-center justify-between text-sm">
                        <Link
                          href={`/admin/membership`}
                          className="text-gray-800 hover:text-accent transition-colors font-medium truncate max-w-xs"
                        >
                          {org.name}
                        </Link>
                        <div className="flex items-center gap-2 ml-3 shrink-0">
                          <MemberStatusBadge status={org.membership_status as string} />
                          <span className={`text-xs font-medium ${days <= 14 ? "text-red-600" : days <= 30 ? "text-amber-600" : "text-gray-400"}`}>
                            {days === 0 ? "today" : days === 1 ? "1 day" : `${days}d`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {upcomingRenewals.length === 0 && (
            <div className="border-t border-gray-100 pt-4 text-sm text-gray-400">
              No renewals due in the next {RENEWAL_WINDOW_DAYS} days.
            </div>
          )}

          <div className="mt-4 text-right">
            <Link href="/admin/membership" className="text-xs text-accent hover:underline">
              Full membership directory →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Sponsorships + Events ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Sponsorships */}
        <div>
          <SectionHeading>Sponsorships</SectionHeading>
          <div className="rounded-xl border border-gray-200 bg-white p-5 h-full">
            {activeAgreements.length === 0 && draftAgreements.length === 0 ? (
              <p className="text-sm text-gray-400">No sponsor agreements yet.</p>
            ) : (
              <>
                {tierGroups.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {tierGroups.map((tier) => (
                      <div key={tier.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: tier.color || "#9CA3AF" }}
                          />
                          <span className="text-sm font-medium text-gray-800">{tier.name}</span>
                        </div>
                        <span className="text-sm text-gray-500">
                          {tier.count} active
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {draftAgreements.length > 0 && (
                  <div className={`${tierGroups.length > 0 ? "border-t border-gray-100 pt-3" : ""}`}>
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                      {draftAgreements.length} draft agreement{draftAgreements.length !== 1 ? "s" : ""} pending
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="mt-4 text-right">
              <Link href="/admin/sponsorships" className="text-xs text-accent hover:underline">
                Manage sponsorships →
              </Link>
            </div>
          </div>
        </div>

        {/* Upcoming events */}
        <div>
          <SectionHeading>Upcoming Events</SectionHeading>
          <div className="rounded-xl border border-gray-200 bg-white p-5 h-full">
            {upcomingEvents.length === 0 ? (
              <p className="text-sm text-gray-400">No upcoming published events.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {upcomingEvents.map((event) => (
                  <li key={event.id}>
                    <Link
                      href={`/admin/events/${event.id}`}
                      className="flex items-center justify-between py-2.5 hover:bg-gray-50 -mx-1 px-1 rounded transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(event.starts_at.replace(" ", "T") + (event.starts_at.includes("Z") ? "" : "Z"))
                            .toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </div>
                      <span className="ml-3 shrink-0 text-xs text-gray-400">
                        {new Date(event.starts_at.replace(" ", "T") + (event.starts_at.includes("Z") ? "" : "Z"))
                          .toLocaleDateString("en-CA", { weekday: "short" })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 text-right">
              <Link href="/admin/events" className="text-xs text-accent hover:underline">
                All events →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── Comms + Board ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

        {/* Recent campaigns */}
        <div>
          <SectionHeading>Recent Campaigns</SectionHeading>
          <div className="rounded-xl border border-gray-200 bg-white p-5 h-full">
            {recentCampaigns.length === 0 ? (
              <p className="text-sm text-gray-400">No campaigns yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {recentCampaigns.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/admin/comms/${c.id}`}
                      className="flex items-center justify-between py-2.5 hover:bg-gray-50 -mx-1 px-1 rounded transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {deliveryCount(c) > 0 ? `${deliveryCount(c).toLocaleString()} sends` : "No sends yet"}
                        </p>
                      </div>
                      <span className={`ml-3 shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${campaignStatusColors[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {c.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 text-right">
              <Link href="/admin/comms" className="text-xs text-accent hover:underline">
                All campaigns →
              </Link>
            </div>
          </div>
        </div>

        {/* Board */}
        <div>
          <SectionHeading>Board</SectionHeading>
          <div className="rounded-xl border border-gray-200 bg-white p-5 h-full flex flex-col gap-4">

            {/* OneDrive setup — super admin only, drive not configured */}
            {isSA && !driveConfigured && (
              <OneDriveSetupCard />
            )}

            {/* Next meeting */}
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Next Meeting</p>
              {nextMeeting ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-semibold text-gray-900">{nextMeeting.meeting_date}</p>
                    {daysToMeeting !== null && (
                      <p className={`text-sm font-medium ${daysToMeeting <= 7 ? "text-amber-600" : "text-gray-500"}`}>
                        {daysToMeeting === 0 ? "Today" : daysToMeeting === 1 ? "Tomorrow" : `In ${daysToMeeting} days`}
                      </p>
                    )}
                  </div>
                  <Link href={`/admin/board/meetings/${nextMeeting.id}`} className="text-xs text-accent hover:underline shrink-0">
                    Documents →
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-gray-400">No upcoming meetings scheduled.</p>
              )}
            </div>

            {/* Financials snapshot */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Financials</p>
                {financials && (
                  <span className="text-xs text-gray-400">{financials.periodStart} → {financials.periodEnd}</span>
                )}
              </div>
              {financials ? (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Revenue",    value: financials.totalRevenue },
                    { label: "Expenses",   value: financials.totalExpenses },
                    { label: "Net Income", value: financials.netIncome, accent: true },
                  ].map(({ label, value, accent }) => (
                    <div key={label}>
                      <p className="text-xs text-gray-400">{label}</p>
                      <p className={`text-sm font-semibold ${accent && value !== null ? value >= 0 ? "text-green-600" : "text-red-600" : "text-gray-900"}`}>
                        {fmtCurrency(value ?? null)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No financial data pulled yet.</p>
              )}
            </div>

            {/* Actions row */}
            <div className="mt-auto pt-2 border-t border-gray-100 flex items-center justify-between">
              {isSA && driveConfigured && <SyncNowButton />}
              <div className="flex gap-3 ml-auto">
                <Link href="/admin/board/meetings" className="text-xs text-gray-500 hover:text-accent transition-colors">Meetings</Link>
                <Link href="/admin/board/financials" className="text-xs text-gray-500 hover:text-accent transition-colors">Financials</Link>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Quick navigation ─────────────────────────────────────── */}
      <div className="border-t border-gray-100 pt-6">
        <SectionHeading>All Sections</SectionHeading>
        <div className="space-y-6">
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading}>
              <p className="mb-2 text-xs font-medium text-gray-400">{section.heading}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {section.items.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors"
                  >
                    <h3 className="text-sm font-semibold text-gray-900">{link.title}</h3>
                    <p className="mt-1 text-xs text-gray-500">{link.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
