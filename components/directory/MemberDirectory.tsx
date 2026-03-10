"use client";

import { useState, useMemo } from "react";
import type { Organization } from "@/lib/database.types";
import DirectoryCard from "./DirectoryCard";

interface MemberDirectoryProps {
  members: Partial<Organization>[];
}

type SortKey = "name" | "province";

export default function MemberDirectory({ members }: MemberDirectoryProps) {
  const [search, setSearch] = useState("");
  const [province, setProvince] = useState("");
  const [sort, setSort] = useState<SortKey>("name");

  // Derive available provinces from actual data
  const availableProvinces = useMemo(() => {
    const set = new Set<string>();
    for (const m of members) {
      if (m.province) set.add(m.province);
    }
    return Array.from(set).sort();
  }, [members]);

  // Filter + sort
  const filtered = useMemo(() => {
    let list = members;

    // Province filter
    if (province) {
      list = list.filter((m) => m.province === province);
    }

    // Text search (name, city, province)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.name?.toLowerCase().includes(q) ||
          m.city?.toLowerCase().includes(q) ||
          m.province?.toLowerCase().includes(q)
      );
    }

    // Sort
    return [...list].sort((a, b) => {
      const av = (sort === "name" ? a.name : a.province) || "";
      const bv = (sort === "name" ? b.name : b.province) || "";
      return av.localeCompare(bv);
    });
  }, [members, province, search, sort]);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        {/* Search */}
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9B9B9B]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by name or city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-lg border border-[#E5E5E5] text-sm focus:outline-none focus:ring-2 focus:ring-[#D60001]/20 focus:border-[#D60001]"
          />
        </div>

        {/* Province filter */}
        <select
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          className="h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D60001]/20 focus:border-[#D60001]"
        >
          <option value="">All Provinces</option>
          {availableProvinces.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D60001]/20 focus:border-[#D60001]"
        >
          <option value="name">Sort by Name</option>
          <option value="province">Sort by Province</option>
        </select>
      </div>

      {/* Results count */}
      <p className="text-sm text-[#6B6B6B] mb-6">
        Showing {filtered.length} of {members.length} member
        {members.length !== 1 ? "s" : ""}
      </p>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((m) => (
            <DirectoryCard key={m.id} organization={m} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-[#6B6B6B]">
          <p className="text-lg mb-2">No members match your filters.</p>
          <button
            onClick={() => {
              setSearch("");
              setProvince("");
            }}
            className="text-[#D60001] hover:underline text-sm"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
