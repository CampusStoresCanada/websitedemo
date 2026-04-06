"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

interface PersonRow {
  id: string;
  display_name: string | null;
  email: string | null;
  global_role: string;
  created_at: string | null;
  orgs: Array<{
    org_id: string;
    org_name: string;
    org_slug: string;
    role: string;
    status: string;
  }>;
}

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  super_admin: { label: "Super Admin", className: "bg-purple-100 text-purple-800" },
  admin: { label: "Admin", className: "bg-blue-100 text-blue-800" },
  user: { label: "User", className: "bg-gray-100 text-gray-600" },
};

export default function PeopleDirectory({
  initialPeople,
}: {
  initialPeople: PersonRow[];
}) {
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("all");
  const [filterHasOrg, setFilterHasOrg] = useState<string>("all");

  const filtered = useMemo(() => {
    let list = initialPeople;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.display_name?.toLowerCase().includes(q) ||
          p.email?.toLowerCase().includes(q) ||
          p.orgs.some((o) => o.org_name.toLowerCase().includes(q))
      );
    }
    if (filterRole !== "all") {
      list = list.filter((p) => p.global_role === filterRole);
    }
    if (filterHasOrg === "yes") {
      list = list.filter((p) => p.orgs.length > 0);
    } else if (filterHasOrg === "no") {
      list = list.filter((p) => p.orgs.length === 0);
    }
    return list;
  }, [initialPeople, search, filterRole, filterHasOrg]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of initialPeople) {
      counts[p.global_role] = (counts[p.global_role] ?? 0) + 1;
    }
    return counts;
  }, [initialPeople]);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-2xl font-bold text-gray-900">{initialPeople.length}</p>
          <p className="text-xs text-gray-500">Total Users</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-2xl font-bold text-purple-700">{roleCounts["super_admin"] ?? 0}</p>
          <p className="text-xs text-gray-500">Super Admins</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-2xl font-bold text-blue-700">{roleCounts["admin"] ?? 0}</p>
          <p className="text-xs text-gray-500">Admins</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-2xl font-bold text-gray-700">
            {initialPeople.filter((p) => p.orgs.length > 0).length}
          </p>
          <p className="text-xs text-gray-500">With Org Membership</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search name, email, or org..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
        />
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="all">All Roles</option>
          {Object.entries(roleCounts).map(([role, count]) => (
            <option key={role} value={role}>
              {ROLE_BADGES[role]?.label ?? role} ({count})
            </option>
          ))}
        </select>
        <select
          value={filterHasOrg}
          onChange={(e) => setFilterHasOrg(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="all">All Users</option>
          <option value="yes">With Org</option>
          <option value="no">No Org</option>
        </select>
        <span className="text-xs text-gray-500 ml-auto">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Role</th>
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Organizations</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((person) => {
              const badge = ROLE_BADGES[person.global_role] ?? {
                label: person.global_role,
                className: "bg-gray-100 text-gray-600",
              };
              return (
                <tr key={person.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-900">
                    {person.display_name || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{person.email || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {person.orgs.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {person.orgs.map((o) => (
                          <Link
                            key={o.org_id}
                            href={`/org/${o.org_slug}/admin`}
                            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-200"
                          >
                            {o.org_name}
                            <span className="text-gray-400">({o.role})</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  No users match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
