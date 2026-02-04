import type { Organization } from "@/lib/database.types";

interface OrgDetailsProps {
  organization: Organization;
}

export default function OrgDetails({ organization }: OrgDetailsProps) {
  return (
    <section>
      <h2 className="text-2xl font-bold text-[#1A1A1A] mb-6">About</h2>

      {organization.company_description ? (
        <div className="prose prose-slate max-w-none">
          <p className="text-[#6B6B6B] text-lg leading-relaxed whitespace-pre-wrap">
            {organization.company_description}
          </p>
        </div>
      ) : (
        <p className="text-[#6B6B6B] italic">
          No description available yet.
        </p>
      )}

      {/* Quick Facts */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-4">
        {organization.primary_category && (
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-sm text-[#6B6B6B] mb-1">Category</p>
            <p className="font-semibold text-[#1A1A1A]">
              {organization.primary_category}
            </p>
          </div>
        )}

        {organization.type === "Member" && organization.membership_status && (
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-sm text-[#6B6B6B] mb-1">Membership</p>
            <p className="font-semibold text-[#1A1A1A] capitalize">
              {organization.membership_status}
            </p>
          </div>
        )}

        {organization.province && (
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-sm text-[#6B6B6B] mb-1">Province</p>
            <p className="font-semibold text-[#1A1A1A]">
              {organization.province}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
