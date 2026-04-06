"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminRole = "super_admin" | "admin" | "user";

interface NavItem {
  href: string;
  label: string;
  matchPrefix?: string;
  /** Minimum role required to see this item. Defaults to "admin". */
  minRole?: AdminRole;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
  /** Minimum role required to see this group header + items. Defaults to "admin". */
  minRole?: AdminRole;
}

const ROLE_LEVEL: Record<AdminRole, number> = {
  user: 0,
  admin: 1,
  super_admin: 2,
};

const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Conference",
    items: [
      { href: "/admin/conference", label: "Conferences", matchPrefix: "/admin/conference" },
    ],
  },
  {
    heading: "Membership",
    items: [
      { href: "/admin/membership", label: "Members & Partners" },
      { href: "/admin/applications", label: "Applications" },
      { href: "/admin/people", label: "People" },
    ],
  },
  {
    heading: "Communications",
    items: [
      { href: "/admin/comms", label: "Campaigns", matchPrefix: "/admin/comms" },
      { href: "/admin/events", label: "Events", matchPrefix: "/admin/events" },
    ],
  },
  {
    heading: "System",
    items: [
      { href: "/admin/ops", label: "Ops Health" },
      { href: "/admin/calendar", label: "Calendar" },
    ],
  },
  {
    heading: "Configuration",
    minRole: "super_admin",
    items: [
      { href: "/admin/policy", label: "Policy Settings" },
      { href: "/admin/circle", label: "Circle" },
      { href: "/admin/content", label: "Site Content" },
      { href: "/admin/pages", label: "Pages & Permissions" },
    ],
  },
];

function hasAccess(role: AdminRole, minRole: AdminRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minRole];
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefix) {
    return pathname.startsWith(item.matchPrefix);
  }
  return pathname === item.href;
}

interface AdminSidebarProps {
  globalRole?: AdminRole;
}

export default function AdminSidebar({ globalRole = "admin" }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto">
      <nav className="px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => {
          if (!hasAccess(globalRole, group.minRole ?? "admin")) return null;
          const visibleItems = group.items.filter((item) =>
            hasAccess(globalRole, item.minRole ?? group.minRole ?? "admin")
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.heading}>
              <h3 className="px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {group.heading}
              </h3>
              <ul className="mt-1 space-y-0.5">
                {visibleItems.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                          active
                            ? "bg-white text-[#EE2A2E] font-medium shadow-sm"
                            : "text-gray-600 hover:bg-white hover:text-gray-900"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
