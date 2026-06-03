import Link from "next/link";
import type { MarketMatch, MarketData } from "@/lib/actions/partner-market";

interface PartnerMarketPanelProps {
  market: MarketData;
}

function ConfidencePip({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const styles = {
    high:   "bg-green-500",
    medium: "bg-amber-400",
    low:    "bg-gray-300",
  };
  const labels = { high: "Strong match", medium: "Likely match", low: "Broad match" };
  return (
    <span
      title={labels[confidence]}
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${styles[confidence]}`}
    />
  );
}

function ContactLine({ match }: { match: MarketMatch }) {
  const contact = match.buyer ?? match.primaryContact;
  if (contact) {
    return (
      <div className="text-xs text-gray-500 mt-0.5">
        {contact.name && <span className="font-medium text-gray-700">{contact.name}</span>}
        {contact.roleTitle && <span className="text-gray-400"> · {contact.roleTitle}</span>}
        {contact.email && (
          <>
            <span className="text-gray-300 mx-1">·</span>
            <a href={`mailto:${contact.email}`} className="text-[#EE2A2E] hover:underline">
              {contact.email}
            </a>
          </>
        )}
      </div>
    );
  }
  if (match.publicEmail) {
    return (
      <div className="text-xs text-gray-500 mt-0.5">
        <a href={`mailto:${match.publicEmail}`} className="text-[#EE2A2E] hover:underline">
          {match.publicEmail}
        </a>
        <span className="text-gray-400 ml-1">(general inbox)</span>
      </div>
    );
  }
  return <p className="text-xs text-gray-400 mt-0.5 italic">No contact on file</p>;
}

export default function PartnerMarketPanel({ market }: PartnerMarketPanelProps) {
  if (market.totalMatches === 0 && market.withoutProcurementCount === 0) {
    return (
      <div className="bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-8 py-12">
          <h2 className="text-xl font-semibold text-[#1A1A1A] mb-2">Your Market</h2>
          <p className="text-sm text-gray-500">
            Add categories to your profile to see which member stores are in your market.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-8 py-12">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-[#1A1A1A]">Your Market</h2>
            {market.totalMatches > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                {market.totalMatches} member {market.totalMatches === 1 ? "store" : "stores"} carry your categories
                {market.totalMatches > 10 && " — showing top 10"}
              </p>
            )}
          </div>
          {/* Export hint — uses Toolkit */}
          {market.totalMatches > 0 && (
            <p className="text-xs text-gray-400 text-right max-w-[200px] leading-snug">
              Use <span className="font-medium text-gray-600">Export</span> in the Toolkit to get the full list with all contacts.
            </p>
          )}
        </div>

        {/* Match list */}
        {market.topMatches.length > 0 && (
          <div className="space-y-2 mb-8">
            {market.topMatches.map((match) => (
              <div
                key={match.orgId}
                className="flex items-start gap-4 rounded-xl border border-gray-100 bg-white px-4 py-3 hover:border-gray-200 hover:shadow-sm transition-all"
              >
                <ConfidencePip confidence={match.confidence} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/org/${match.orgSlug}`}
                      className="text-sm font-semibold text-[#1A1A1A] hover:text-[#EE2A2E] transition-colors"
                    >
                      {match.orgName}
                    </Link>
                    {match.province && (
                      <span className="text-xs text-gray-400">{match.province}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-400">{match.matchingCategory}</span>
                    {match.matchingSubcategories.length > 0 && (
                      <>
                        <span className="text-gray-300">›</span>
                        <span className="text-xs text-gray-500">
                          {match.matchingSubcategories.join(", ")}
                        </span>
                      </>
                    )}
                  </div>
                  <ContactLine match={match} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Without procurement count */}
        {market.withoutProcurementCount > 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-4">
            <p className="text-sm font-medium text-gray-700">
              {market.withoutProcurementCount} member {market.withoutProcurementCount === 1 ? "store hasn't" : "stores haven't"} set up their procurement data yet.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Use <span className="font-medium">Export</span> in the Toolkit to notify them — sent at most once per week across the platform.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
