import Link from "next/link";

export const metadata = {
  title: "Admin Console | Campus Stores Canada",
};

const SECTIONS = [
  {
    heading: "Operations",
    items: [
      {
        href: "/admin/ops",
        title: "Ops Health",
        description: "Monitor system health, job status, and integration sync.",
      },
      {
        href: "/admin/calendar",
        title: "Operational Calendar",
        description: "Unified timeline of conference, renewal, comms, and system milestones.",
      },
    ],
  },
  {
    heading: "Conference",
    items: [
      {
        href: "/admin/conference",
        title: "Conference Management",
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
        href: "/admin/people",
        title: "People",
        description: "User accounts, contacts, and organizational roles.",
      },
      {
        href: "/admin/applications",
        title: "Applications",
        description: "Review pending membership and partner applications.",
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
    heading: "Configuration",
    items: [
      {
        href: "/admin/policy",
        title: "Policy Settings",
        description: "Review and publish policy changes for billing, scheduling, and retention.",
      },
      {
        href: "/admin/integrations",
        title: "Integrations",
        description: "Circle, Stripe, QuickBooks — sync controls and feature flags.",
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

export default function AdminConsolePage() {
  return (
    <main>
      <h1 className="text-2xl font-bold text-gray-900">Admin Console</h1>
      <p className="mt-2 text-sm text-gray-600">
        Central entry point for operations, policy, conference, and content tools.
      </p>

      <div className="mt-8 space-y-8">
        {SECTIONS.map((section) => (
          <div key={section.heading}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
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
