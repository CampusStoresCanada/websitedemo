import Link from "next/link";
import type { Organization } from "@/lib/database.types";

interface DirectoryCardProps {
  organization: Partial<Organization>;
  showCategory?: boolean;
}

export default function DirectoryCard({
  organization,
  showCategory = false,
}: DirectoryCardProps) {
  const name = organization.name || "Unnamed";
  const slug = organization.slug;
  const logo = organization.logo_url || organization.logo_horizontal_url;
  const location = [organization.city, organization.province]
    .filter(Boolean)
    .join(", ");

  const inner = (
    <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 h-full flex flex-col hover:border-[#D4D4D4] hover:shadow-md transition-all group">
      {/* Logo / Initials */}
      <div className="flex items-center gap-4 mb-4">
        {logo ? (
          <img
            src={logo}
            alt={name}
            className="w-12 h-12 rounded-lg object-contain flex-shrink-0 bg-slate-50"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
            <span className="text-slate-400 font-semibold text-sm">
              {getInitials(name)}
            </span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[#1A1A1A] truncate group-hover:text-[#D60001] transition-colors">
            {name}
          </h3>
          {location && (
            <p className="text-sm text-[#6B6B6B] truncate">{location}</p>
          )}
        </div>
      </div>

      {/* Category badge */}
      {showCategory && organization.primary_category && (
        <div className="mb-3">
          <span className="inline-block px-2.5 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
            {organization.primary_category}
          </span>
        </div>
      )}

      {/* Description */}
      {organization.company_description && (
        <p className="text-sm text-[#6B6B6B] line-clamp-3 flex-1">
          {organization.company_description}
        </p>
      )}
    </div>
  );

  if (slug) {
    return <Link href={`/org/${slug}`}>{inner}</Link>;
  }

  return inner;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
