/**
 * The admin console's navigation, in one place.
 *
 * The sidebar and the "All Sections" grid on /admin are two renderings of the
 * same map, not two lists that happen to agree. They used to be two hand-kept
 * arrays, and they drifted: Elections shipped to production in August and was
 * missing from both, /admin/contact existed only in the tile grid, and
 * Partner Asks, New Partners, Hero Area and QuickBooks only in the sidebar.
 * A reader could not tell which omissions were deliberate. Now adding a
 * section here lights it up in both places, and a page that belongs in neither
 * is a page nobody linked on purpose.
 *
 * `label` is the sidebar's short form; `description` is the sentence the tile
 * carries. `title` overrides the label on the tile where the short form would
 * be too terse out of the sidebar's context.
 */

export type AdminRole = "super_admin" | "admin" | "user";

/**
 * A condition that has to hold for an item to appear at all.
 *
 * ⚠️ Use this sparingly, and never for a page that is the way to *start* the
 * thing being tested. Elections was unreachable for exactly that reason — the
 * only link to the page that opens a cycle was on a widget that rendered only
 * once a cycle was already open. A gate is right when the page is a work
 * surface that has no work outside the window, not when it is a door.
 */
export type NavCondition = "renewalSeason";

export interface NavItem {
  href: string;
  /** Sidebar text. */
  label: string;
  /** Tile heading, when the sidebar's label reads too thin on its own. */
  title?: string;
  /** Tile body. */
  description: string;
  /** Prefix that marks this item active; defaults to an exact href match. */
  matchPrefix?: string;
  /** Minimum role required to see this item. Defaults to the group's. */
  minRole?: AdminRole;
  /** Extra condition beyond role. Absent means always shown. */
  showWhen?: NavCondition;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
  /** Minimum role required to see this group header + items. Defaults to "admin". */
  minRole?: AdminRole;
}

export const ROLE_LEVEL: Record<AdminRole, number> = {
  user: 0,
  admin: 1,
  super_admin: 2,
};

export const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Conference",
    items: [
      {
        href: "/admin/conference",
        label: "Conferences",
        description: "Manage conference instances, registrations, scheduling, and commerce.",
        matchPrefix: "/admin/conference",
      },
    ],
  },
  {
    heading: "Membership",
    items: [
      {
        href: "/admin/membership",
        label: "Members & Partners",
        description: "Organization directory, billing, renewals, and benchmarking.",
      },
      {
        href: "/admin/applications",
        label: "Applications",
        description: "Review pending membership and partner applications.",
      },
      {
        href: "/admin/people",
        label: "People",
        description: "User accounts, contacts, and organizational roles.",
      },
      {
        // Lives outside /admin — benchmarking is its own sub-app with its own
        // sidebar, and until now the only way in from the console was an
        // unlabelled secondary button on the membership page.
        href: "/benchmarking/admin",
        label: "Benchmarking",
        title: "Benchmarking",
        description: "Survey editor, submissions, review queue, and participant flags.",
        matchPrefix: "/benchmarking/admin",
      },
      {
        // Per-person, not a shared surface: it lists the stores assigned to
        // whoever is signed in, handed out from the Renewals tab on a board
        // meeting. Hidden outside the renewal season, which is derived from
        // the same policy config the reminder and grace crons run on.
        href: "/admin/renewals",
        label: "My renewal calls",
        title: "My Renewal Calls",
        description: "Stores assigned to you this cycle, with contact details and call status.",
        showWhen: "renewalSeason",
      },
    ],
  },
  {
    heading: "Board Portal",
    items: [
      {
        href: "/admin/board/meetings",
        label: "Meetings",
        title: "Board Meetings",
        description: "Meeting records and synced documents from OneDrive.",
        matchPrefix: "/admin/board/meetings",
      },
      {
        href: "/admin/board/financials",
        label: "Financials",
        title: "Board Financials",
        description: "QuickBooks P&L and Balance Sheet snapshots for directors.",
        matchPrefix: "/admin/board/financials",
      },
      {
        href: "/admin/elections",
        label: "Elections",
        title: "Board Elections",
        description: "Open a cycle, review nominations, and monitor the ballot.",
        matchPrefix: "/admin/elections",
      },
    ],
  },
  {
    heading: "Sponsorships",
    items: [
      {
        href: "/admin/sponsorships",
        label: "Sponsorships",
        description: "Manage sponsorship tiers, agreements, and placements.",
        matchPrefix: "/admin/sponsorships",
      },
    ],
  },
  {
    heading: "Communications",
    items: [
      {
        href: "/admin/comms",
        label: "Campaigns",
        title: "Campaigns & Templates",
        description: "Manage email campaigns, templates, and delivery analytics.",
        matchPrefix: "/admin/comms",
      },
      {
        href: "/admin/comms/asks",
        label: "Partner Asks",
        description: "Match partner offers to member needs and prepare the outreach.",
        matchPrefix: "/admin/comms/asks",
      },
      {
        href: "/admin/comms/announcements",
        label: "New Partners",
        title: "New Partner Announcements",
        description: "Announce partners as they move from approved to active.",
        matchPrefix: "/admin/comms/announcements",
      },
      {
        href: "/admin/events",
        label: "Events",
        description: "Create, review, and manage non-conference events.",
        matchPrefix: "/admin/events",
      },
      {
        href: "/admin/contact",
        label: "Contact Inquiries",
        description: "Inbound contact form submissions, including IDN requests.",
      },
    ],
  },
  {
    heading: "System",
    items: [
      {
        href: "/admin/ops",
        label: "Ops Health",
        description: "Monitor job status, alerts, webhooks, and integration sync.",
      },
      {
        href: "/admin/calendar",
        label: "Calendar",
        title: "Operational Calendar",
        description: "Unified timeline of conference, renewal, comms, and system milestones.",
      },
    ],
  },
  {
    heading: "Configuration",
    minRole: "super_admin",
    items: [
      {
        href: "/admin/policy",
        label: "Policy Settings",
        description: "Review and publish policy changes for billing, scheduling, and retention.",
      },
      {
        href: "/admin/circle",
        label: "Circle",
        title: "Circle Integration",
        description: "SSO cutover controls, member mapping, and sync status.",
      },
      {
        href: "/admin/content",
        label: "Site Content",
        description: "Manage board/staff listings and public website content.",
      },
      {
        href: "/admin/pages",
        label: "Pages & Permissions",
        description: "Review route ownership, visibility, and permission requirements.",
      },
      {
        href: "/admin/hero-area",
        label: "Hero Area",
        description: "Manage the rotating hero panels on the public home page.",
      },
      {
        href: "/admin/settings/quickbooks",
        label: "QuickBooks",
        title: "QuickBooks Settings",
        description: "Connection status, export queue, and accounting sync configuration.",
      },
    ],
  },
];

/** Conditions that currently hold, resolved server-side once per render. */
export interface NavConditions {
  renewalSeason: boolean;
}

export function hasAccess(role: AdminRole, minRole: AdminRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole];
}

/**
 * The groups this viewer should actually see, with hidden items and
 * emptied-out groups removed. Both renderings call this, so the sidebar and
 * the tile grid cannot disagree about who sees what — before this, the tile
 * grid showed the super-admin-only Configuration section to every admin.
 */
export function visibleNavGroups(
  role: AdminRole,
  conditions: NavConditions
): { heading: string; items: NavItem[] }[] {
  const groups: { heading: string; items: NavItem[] }[] = [];

  for (const group of NAV_GROUPS) {
    if (!hasAccess(role, group.minRole ?? "admin")) continue;

    const items = group.items.filter((item) => {
      if (!hasAccess(role, item.minRole ?? group.minRole ?? "admin")) return false;
      if (item.showWhen && !conditions[item.showWhen]) return false;
      return true;
    });

    if (items.length > 0) groups.push({ heading: group.heading, items });
  }

  return groups;
}
