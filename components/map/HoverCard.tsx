"use client";

import Image from "next/image";
import Link from "next/link";
import type { Organization } from "@/lib/database.types";

interface HoverCardProps {
  organization: Organization | null;
  position?: { x: number; y: number };
}

export default function HoverCard({ organization }: HoverCardProps) {
  if (!organization) return null;

  return (
    <div className="absolute top-8 right-8 z-20 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 border border-[#E5E5E5]">
        <div className="flex items-start gap-4 mb-4">
          {organization.logo_url ? (
            <div className="w-14 h-14 rounded-xl bg-white border border-[#E5E5E5] flex items-center justify-center flex-shrink-0 overflow-hidden">
              <Image
                src={organization.logo_url}
                alt={organization.name}
                width={48}
                height={48}
                className="object-contain"
                unoptimized
              />
            </div>
          ) : (
            <div
              className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ${
                organization.type === "Member" ? "bg-[#D60001]" : "bg-[#3B82F6]"
              }`}
            >
              <span className="text-white font-bold text-lg">
                {organization.name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")}
              </span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-[#1A1A1A] truncate">
              {organization.name}
            </h3>
            <p className="text-sm text-[#6B6B6B]">
              {organization.city}, {organization.province}
            </p>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <span
            className={`px-3 py-1 text-xs font-medium rounded-full ${
              organization.type === "Member"
                ? "bg-[#D60001]/10 text-[#D60001]"
                : "bg-[#3B82F6]/10 text-[#3B82F6]"
            }`}
          >
            {organization.type}
          </span>
          {organization.primary_category && (
            <span className="px-3 py-1 bg-slate-100 text-[#6B6B6B] text-xs font-medium rounded-full truncate">
              {organization.primary_category}
            </span>
          )}
        </div>

        {organization.company_description ? (
          <p className="text-sm text-[#6B6B6B] mb-4 line-clamp-2">
            {organization.company_description}
          </p>
        ) : (
          <p className="text-sm text-[#6B6B6B] mb-4">
            {organization.type === "Member"
              ? "Campus store serving students with course materials and merchandise."
              : "Trusted vendor partner in the CSC network."}
          </p>
        )}

        <div className="flex items-center justify-between">
          <Link
            href={`/org/${organization.slug}`}
            className="text-sm font-medium text-[#D60001] hover:text-[#B00001] transition-colors"
          >
            View Profile →
          </Link>
          {organization.website && (
            <a
              href={organization.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A] transition-colors"
            >
              Website ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
