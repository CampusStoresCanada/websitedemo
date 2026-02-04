import Image from "next/image";
import type { Organization } from "@/lib/database.types";

interface OrgProfileHeroProps {
  organization: Organization;
}

export default function OrgProfileHero({ organization }: OrgProfileHeroProps) {
  return (
    <div className="relative">
      {/* Banner Background */}
      <div className="h-48 md:h-64 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 relative overflow-hidden">
        {organization.banner_url ? (
          <Image
            src={organization.banner_url}
            alt={`${organization.name} banner`}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 opacity-30">
            <div
              className={`absolute inset-0 ${
                organization.type === "Member"
                  ? "bg-gradient-to-br from-[#D60001]/20 to-transparent"
                  : "bg-gradient-to-br from-[#3B82F6]/20 to-transparent"
              }`}
            />
          </div>
        )}
      </div>

      {/* Profile Info */}
      <div className="max-w-7xl mx-auto px-6">
        <div className="relative -mt-16 md:-mt-20 flex flex-col md:flex-row md:items-end gap-6 pb-8">
          {/* Logo */}
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-2xl bg-white border-4 border-white shadow-lg flex items-center justify-center overflow-hidden flex-shrink-0">
            {organization.logo_url ? (
              <Image
                src={organization.logo_url}
                alt={organization.name}
                width={160}
                height={160}
                className="object-contain p-4"
                unoptimized
              />
            ) : (
              <div
                className={`w-full h-full flex items-center justify-center ${
                  organization.type === "Member" ? "bg-[#D60001]" : "bg-[#3B82F6]"
                }`}
              >
                <span className="text-white font-bold text-4xl">
                  {organization.name
                    .split(" ")
                    .map((w) => w[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join("")}
                </span>
              </div>
            )}
          </div>

          {/* Name and Meta */}
          <div className="flex-1 pb-2">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <span
                className={`px-3 py-1 text-sm font-medium rounded-full ${
                  organization.type === "Member"
                    ? "bg-[#D60001]/10 text-[#D60001]"
                    : "bg-[#3B82F6]/10 text-[#3B82F6]"
                }`}
              >
                {organization.type}
              </span>
              {organization.primary_category && (
                <span className="px-3 py-1 bg-slate-100 text-[#6B6B6B] text-sm font-medium rounded-full">
                  {organization.primary_category}
                </span>
              )}
              {organization.membership_status === "active" && organization.type === "Member" && (
                <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">
                  Active Member
                </span>
              )}
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-[#1A1A1A] tracking-tight">
              {organization.name}
            </h1>
            <p className="text-lg text-[#6B6B6B] mt-1">
              {organization.city}, {organization.province}
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="flex gap-3 md:pb-2">
            {organization.website && (
              <a
                href={organization.website}
                target="_blank"
                rel="noopener noreferrer"
                className="h-12 px-6 bg-[#D60001] hover:bg-[#B00001] text-white font-medium rounded-full transition-all hover:shadow-lg hover:shadow-red-500/25 flex items-center gap-2"
              >
                Visit Website
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
            {organization.catalogue_url && (
              <a
                href={organization.catalogue_url}
                target="_blank"
                rel="noopener noreferrer"
                className="h-12 px-6 bg-white hover:bg-slate-50 text-[#1A1A1A] font-medium rounded-full border border-[#E5E5E5] transition-all hover:border-[#D4D4D4] flex items-center gap-2"
              >
                View Catalogue
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
