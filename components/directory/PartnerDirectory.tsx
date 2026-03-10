"use client";

import { useState, useMemo } from "react";
import type { Organization } from "@/lib/database.types";
import { PARTNER_PRIMARY_CATEGORIES } from "@/lib/constants/partner-categories";
import DirectoryCard from "./DirectoryCard";
import JoinCTA from "@/components/ui/JoinCTA";

interface PartnerDirectoryProps {
  partners: Partial<Organization>[];
}

type SortKey = "name" | "province" | "category";

export default function PartnerDirectory({ partners }: PartnerDirectoryProps) {
  const [search, setSearch] = useState("");
  const [province, setProvince] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<SortKey>("name");

  // Derive available provinces from actual data
  const availableProvinces = useMemo(() => {
    const set = new Set<string>();
    for (const p of partners) {
      if (p.province) set.add(p.province);
    }
    return Array.from(set).sort();
  }, [partners]);

  // Filter + sort
  const filtered = useMemo(() => {
    let list = partners;

    // Province filter
    if (province) {
      list = list.filter((p) => p.province === province);
    }

    // Category filter
    if (category) {
      list = list.filter((p) => p.primary_category === category);
    }

    // Text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.city?.toLowerCase().includes(q) ||
          p.province?.toLowerCase().includes(q) ||
          p.company_description?.toLowerCase().includes(q) ||
          p.primary_category?.toLowerCase().includes(q)
      );
    }

    // Sort
    return [...list].sort((a, b) => {
      let av: string, bv: string;
      switch (sort) {
        case "province":
          av = a.province || "";
          bv = b.province || "";
          break;
        case "category":
          av = a.primary_category || "";
          bv = b.primary_category || "";
          break;
        default:
          av = a.name || "";
          bv = b.name || "";
      }
      return av.localeCompare(bv);
    });
  }, [partners, province, category, search, sort]);

  return (
    <div>
      {/* Anonymous CTA */}
      <div className="mb-8">
        <JoinCTA
          message="Get a membership to access full partner details and contact information."
          ctaText="Join CSC"
          ctaLink="/signup"
        />
      </div>

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
            placeholder="Search partners…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-lg border border-[#E5E5E5] text-sm focus:outline-none focus:ring-2 focus:ring-[#D60001]/20 focus:border-[#D60001]"
          />
        </div>

        {/* Category filter */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#D60001]/20 focus:border-[#D60001]"
        >
          <option value="">All Categories</option>
          {PARTNER_PRIMARY_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

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
          <option value="category">Sort by Category</option>
        </select>
      </div>

      {/* Results count */}
      <p className="text-sm text-[#6B6B6B] mb-6">
        Showing {filtered.length} of {partners.length} partner
        {partners.length !== 1 ? "s" : ""}
      </p>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <DirectoryCard key={p.id} organization={p} showCategory />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-[#6B6B6B]">
          <p className="text-lg mb-2">No partners match your filters.</p>
          <button
            onClick={() => {
              setSearch("");
              setProvince("");
              setCategory("");
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
