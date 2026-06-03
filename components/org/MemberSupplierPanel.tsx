"use client";

import Link from "next/link";
import type { SupplierMatch, SupplierData } from "@/lib/actions/member-suppliers";

interface MemberSupplierPanelProps {
  data: SupplierData;
}

function ConfidencePip({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const styles = { high: "bg-green-500", medium: "bg-amber-400", low: "bg-gray-300" };
  const labels = { high: "Strong match", medium: "Likely match", low: "Broad match" };
  return <span title={labels[confidence]} className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${styles[confidence]}`} />;
}

function SupplierCard({ match }: { match: SupplierMatch }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 hover:border-gray-200 hover:shadow-sm transition-all space-y-1.5">
      {/* Partner name + location */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link href={`/org/${match.orgSlug}`} className="text-sm font-semibold text-[#1A1A1A] hover:text-[#EE2A2E] transition-colors">
          {match.orgName}
        </Link>
        {match.province && <span className="text-xs text-gray-400">{match.province}</span>}
        {match.hasCertMatch && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">
            Cert match
          </span>
        )}
      </div>

      {/* Category */}
      <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-400">
        <span>{match.matchingCategory}</span>
        {match.matchingSubcategories.length > 0 && (
          <>
            <span className="text-gray-300">›</span>
            <span className="text-gray-500">{match.matchingSubcategories.join(", ")}</span>
          </>
        )}
      </div>

      {/* Contact → confidence pip → catalogue */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {match.primaryContact ? (
            <div className="text-xs text-gray-500 truncate">
              {match.primaryContact.name && (
                <span className="font-medium text-gray-700">{match.primaryContact.name}</span>
              )}
              {match.primaryContact.roleTitle && (
                <span className="text-gray-400"> · {match.primaryContact.roleTitle}</span>
              )}
              {match.primaryContact.email && (
                <>
                  <span className="text-gray-300 mx-1">·</span>
                  <a href={`mailto:${match.primaryContact.email}`} className="text-[#EE2A2E] hover:underline">
                    {match.primaryContact.email}
                  </a>
                </>
              )}
            </div>
          ) : (
            <span className="text-xs text-gray-400 italic">No contact on file</span>
          )}
        </div>

        <ConfidencePip confidence={match.confidence} />

        {match.catalogueUrl && (
          <a
            href={match.catalogueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs font-medium text-[#EE2A2E] hover:text-[#D92327] transition-colors"
          >
            Catalogue →
          </a>
        )}
      </div>
    </div>
  );
}

export default function MemberSupplierPanel({ data }: MemberSupplierPanelProps) {
  return (
    <div id="my-suppliers" className="bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-8 py-12">

        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-[#1A1A1A]">My Suppliers</h2>
            {data.hasAssignments && data.totalMatches > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                {data.totalMatches} {data.totalMatches === 1 ? "supplier" : "suppliers"} matched to your buying categories
                {data.totalMatches > 10 && " — showing top 10"}
              </p>
            )}
          </div>
          {data.hasAssignments && data.totalMatches > 0 && (
            <p className="text-xs text-gray-400 text-right max-w-[200px] leading-snug">
              Use <span className="font-medium text-gray-600">Export</span> in the Toolkit for the full list.
            </p>
          )}
        </div>

        {/* No buying assignments yet — Flag prompt */}
        {!data.hasAssignments && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-6">
            <p className="text-sm font-medium text-gray-700 mb-1">Your supplier list isn't set up yet.</p>
            <p className="text-sm text-gray-500 leading-relaxed">
              Use the <span className="font-medium text-gray-700">Flag</span> tool in the Toolkit, then tap your name in the Staffing section to let your org admin know what categories you buy. Once your buying assignments are set up, your personalized supplier list will appear here.
            </p>
          </div>
        )}

        {/* Has assignments but no matches */}
        {data.hasAssignments && data.totalMatches === 0 && (
          <p className="text-sm text-gray-500">
            No partners found for your current buying categories. Check back as more partners join the network.
          </p>
        )}

        {/* Match list */}
        {data.topMatches.length > 0 && (
          <div className="space-y-2">
            {data.topMatches.map(match => (
              <SupplierCard key={match.orgId} match={match} />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
