"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  visibleNavGroups,
  type AdminRole,
  type NavConditions,
  type NavItem,
} from "@/lib/admin/nav";

function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefix) {
    return pathname.startsWith(item.matchPrefix);
  }
  return pathname === item.href;
}

/**
 * Longest-prefix wins within a group.
 *
 * Without this, a nested item highlights its parent too: "Partner Asks"
 * (/admin/comms/asks) also satisfies "Campaigns" (/admin/comms), lighting up
 * both. Picking the most specific match keeps exactly one item active.
 */
function activeHref(pathname: string, items: NavItem[]): string | null {
  let best: NavItem | null = null;
  for (const item of items) {
    if (!isActive(pathname, item)) continue;
    const len = (item.matchPrefix ?? item.href).length;
    if (!best || len > (best.matchPrefix ?? best.href).length) best = item;
  }
  return best?.href ?? null;
}

interface AdminSidebarProps {
  globalRole?: AdminRole;
  /**
   * Resolved server-side in the layout: this is a client component and cannot
   * read policy config or the clock the same way the crons do.
   */
  conditions?: NavConditions;
}

export default function AdminSidebar({
  globalRole = "admin",
  conditions = { renewalSeason: false },
}: AdminSidebarProps) {
  const pathname = usePathname();
  const groups = visibleNavGroups(globalRole, conditions);

  return (
    <aside className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto">
      <nav className="px-3 py-4 space-y-5">
        {groups.map((group) => (
          <div key={group.heading}>
            <h3 className="px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              {group.heading}
            </h3>
            <ul className="mt-1 space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === activeHref(pathname, group.items);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                        active
                          ? "bg-white text-accent font-medium shadow-sm"
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
        ))}
      </nav>
    </aside>
  );
}
