import Link from "next/link";

export const metadata = {
  title: "Admin Console | Campus Stores Canada",
};

const LINKS = [
  {
    href: "/admin/calendar",
    title: "Operational Calendar",
    description: "Unified timeline of conference, renewal, comms, and system milestones.",
  },
  {
    href: "/admin/ops",
    title: "Ops Health",
    description: "Monitor system health and integration status.",
  },
  {
    href: "/admin/pages",
    title: "Pages & Permissions",
    description: "Review route ownership, visibility, and permission requirements.",
  },
  {
    href: "/admin/conference",
    title: "Conference Management",
    description: "Manage conference instances, statuses, and operations.",
  },
  {
    href: "/admin/events",
    title: "Events",
    description: "Create, review, and manage non-conference events. Approve member-submitted events.",
  },
  {
    href: "/admin/conference",
    title: "Legal & Compliance",
    description:
      "Manage conference legal versions, acceptance coverage, and retention readiness.",
  },
  {
    href: "/admin/circle",
    title: "Circle Cutover",
    description: "Launch Day Auth Cutover — feature flags, member mapping backfill, pre-flight validation.",
  },
  {
    href: "/admin/policy",
    title: "Policy Settings",
    description: "Review and publish policy changes.",
  },
  {
    href: "/admin/content",
    title: "Site Content",
    description: "Manage board/staff and public website content.",
  },
  {
    href: "/admin/applications",
    title: "Applications",
    description: "Review pending applications and processing status.",
  },
  {
    href: "/admin/comms",
    title: "Communications",
    description: "Manage email campaigns, templates, and delivery analytics.",
  },
  {
    href: "/benchmarking/admin",
    title: "Benchmarking Admin",
    description: "Access benchmarking submission review tools.",
  },
];

export default function AdminConsolePage() {
  return (
    <main>
      <h1 className="text-2xl font-bold text-gray-900">Admin Console</h1>
      <p className="mt-2 text-sm text-gray-600">
        Central entry point for operations, policy, conference, and content tools.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {LINKS.map((link) => (
          <Link
            key={`${link.href}:${link.title}`}
            href={link.href}
            className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors"
          >
            <h2 className="text-base font-semibold text-gray-900">{link.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{link.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
