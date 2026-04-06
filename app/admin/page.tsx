import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { CONFERENCE_STATUS_LABELS, type ConferenceStatus } from "@/lib/constants/conference";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const metadata = {
  title: "Admin Console | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Statuses that mean a conference is in active operational use
const OPS_STATUSES = new Set(["active", "scheduling", "registration_closed", "registration_open"]);

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-600",
    registration_open: "bg-green-100 text-green-700",
    registration_closed: "bg-yellow-100 text-yellow-700",
    scheduling: "bg-blue-100 text-blue-700",
    active: "bg-purple-100 text-purple-700",
    completed: "bg-gray-100 text-gray-500",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {CONFERENCE_STATUS_LABELS[status as ConferenceStatus] ?? status}
    </span>
  );
}

function QuickLink({
  href,
  label,
  primary = false,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
        primary
          ? "border-[#EE2A2E] bg-[#EE2A2E] text-white hover:bg-[#b50001]"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {label}
    </Link>
  );
}

const SECTIONS = [
  {
    heading: "Conference",
    items: [
      {
        href: "/admin/conference",
        title: "Conferences",
        description: "Manage conference instances, registrations, scheduling, and commerce.",
      },
    ],
  },
  {
    heading: "Membership",
    items: [
      {
        href: "/admin/membership",
        title: "Members & Partners",
        description: "Organization directory, billing, renewals, and benchmarking.",
      },
      {
        href: "/admin/applications",
        title: "Applications",
        description: "Review pending membership and partner applications.",
      },
      {
        href: "/admin/people",
        title: "People",
        description: "User accounts, contacts, and organizational roles.",
      },
    ],
  },
  {
    heading: "Communications",
    items: [
      {
        href: "/admin/comms",
        title: "Campaigns & Templates",
        description: "Manage email campaigns, templates, and delivery analytics.",
      },
      {
        href: "/admin/events",
        title: "Events",
        description: "Create, review, and manage non-conference events.",
      },
    ],
  },
  {
    heading: "System",
    items: [
      {
        href: "/admin/ops",
        title: "Ops Health",
        description: "Monitor job status, alerts, webhooks, and integration sync.",
      },
      {
        href: "/admin/calendar",
        title: "Operational Calendar",
        description: "Unified timeline of conference, renewal, comms, and system milestones.",
      },
    ],
  },
  {
    heading: "Configuration",
    items: [
      {
        href: "/admin/policy",
        title: "Policy Settings",
        description: "Review and publish policy changes for billing, scheduling, and retention.",
      },
      {
        href: "/admin/circle",
        title: "Circle Integration",
        description: "SSO cutover controls, member mapping, and sync status.",
      },
      {
        href: "/admin/content",
        title: "Site Content",
        description: "Manage board/staff listings and public website content.",
      },
      {
        href: "/admin/pages",
        title: "Pages & Permissions",
        description: "Review route ownership, visibility, and permission requirements.",
      },
    ],
  },
];

export default async function AdminConsolePage() {
  const adminClient = createAdminClient();

  const [conferenceResult, appCountResult, alertCountResult] = await Promise.all([
    // Most recent non-archived, non-completed conference
    adminClient
      .from("conference_instances")
      .select("id, name, year, edition_code, status")
      .not("status", "in", "(archived,completed)")
      .order("year", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Pending applications
    adminClient
      .from("signup_applications")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "pending_review", "pending_verification"]),
    // Open ops alerts
    adminClient
      .from("ops_alerts")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
  ]);

  const currentConference = conferenceResult.data ?? null;
  const appCount = appCountResult.count ?? 0;
  const alertCount = alertCountResult.count ?? 0;
  const isOpsActive = currentConference
    ? OPS_STATUSES.has(currentConference.status)
    : false;

  return (
    <main>
      <AdminPageHeader title="Admin Console" />

      {/* ── Status strip ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {/* Current conference */}
        <Link
          href={
            currentConference
              ? `/admin/conference/${currentConference.id}/overview`
              : "/admin/conference"
          }
          className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors"
        >
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">
            Current Conference
          </div>
          {currentConference ? (
            <>
              <div className="text-base font-semibold leading-snug text-gray-900">
                {currentConference.name}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-sm text-gray-500">{currentConference.year}</span>
                <StatusBadge status={currentConference.status} />
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400">No active conference</div>
          )}
        </Link>

        {/* Pending applications */}
        <Link
          href="/admin/applications"
          className={`rounded-xl border bg-white p-4 hover:border-gray-300 transition-colors ${
            appCount > 0 ? "border-amber-300" : "border-gray-200"
          }`}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">
            Pending Applications
          </div>
          <div
            className={`text-3xl font-bold ${
              appCount > 0 ? "text-amber-600" : "text-gray-300"
            }`}
          >
            {appCount}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {appCount === 1
              ? "application awaiting review"
              : "applications awaiting review"}
          </div>
        </Link>

        {/* Open alerts */}
        <Link
          href="/admin/ops"
          className={`rounded-xl border bg-white p-4 hover:border-gray-300 transition-colors ${
            alertCount >= 3
              ? "border-red-300"
              : alertCount > 0
              ? "border-amber-300"
              : "border-gray-200"
          }`}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">
            Open Alerts
          </div>
          <div
            className={`text-3xl font-bold ${
              alertCount >= 3
                ? "text-red-600"
                : alertCount > 0
                ? "text-amber-600"
                : "text-gray-300"
            }`}
          >
            {alertCount}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {alertCount === 0
              ? "system healthy"
              : alertCount === 1
              ? "alert needs attention"
              : "alerts need attention"}
          </div>
        </Link>
      </div>

      {/* ── Conference quick access ───────────────────────────── */}
      {currentConference && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-gray-900">
              {currentConference.name} — Quick Access
            </h2>
            <Link
              href={`/admin/conference/${currentConference.id}/overview`}
              className="text-xs text-[#EE2A2E] hover:underline"
            >
              All sections →
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {isOpsActive ? (
              <>
                <QuickLink
                  href={`/admin/conference/${currentConference.id}/war-room`}
                  label="War Room"
                  primary
                />
                <QuickLink
                  href={`/admin/conference/${currentConference.id}/registrations`}
                  label="Registrations"
                />
                <QuickLink
                  href={`/admin/conference/${currentConference.id}/badges`}
                  label="Badge Ops"
                />
                <QuickLink
                  href={`/admin/conference/${currentConference.id}/schedule-ops`}
                  label="Schedule Ops"
                />
                <QuickLink
                  href={`/admin/conference/${currentConference.id}/travel-import`}
                  label="Travel Import"
                />
              </>
            ) : (
              <>
                <QuickLink
                  href={`/admin/conference/${currentConference.id}/overview`}
                  label="Overview"
                />
                <QuickLink
                  href={`/admin/conference/${currentConference.id}/setup`}
                  label="Schedule Design"
                />
                <QuickLink
                  href={`/admin/conference/${currentConference.id}/products`}
                  label="Products"
                />
                <QuickLink
                  href={`/admin/conference/${currentConference.id}/registrations`}
                  label="Registrations"
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Section navigation ───────────────────────────────── */}
      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <div key={section.heading}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {section.heading}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {section.items.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors"
                >
                  <h3 className="text-base font-semibold text-gray-900">{link.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{link.description}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
