interface ResponseRateCardProps {
  fiscalYear: number;
  totalMemberOrgs: number;
  drafts: number;
  submitted: number;
  verified: number;
}

export default function ResponseRateCard({
  fiscalYear,
  totalMemberOrgs,
  drafts,
  submitted,
  verified,
}: ResponseRateCardProps) {
  const totalResponses = drafts + submitted;
  const pct = totalMemberOrgs > 0 ? Math.round((submitted / totalMemberOrgs) * 100) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
        FY{fiscalYear} Response Rate
      </h3>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex items-end justify-between mb-1.5">
          <span className="text-3xl font-bold text-gray-900">{pct}%</span>
          <span className="text-sm text-gray-500">
            {submitted} / {totalMemberOrgs} submitted
          </span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#EE2A2E] rounded-full transition-all duration-500"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center p-2 bg-amber-50 rounded-lg">
          <div className="text-lg font-bold text-amber-700">{drafts}</div>
          <div className="text-xs text-amber-600">In Progress</div>
        </div>
        <div className="text-center p-2 bg-green-50 rounded-lg">
          <div className="text-lg font-bold text-green-700">{submitted}</div>
          <div className="text-xs text-green-600">Submitted</div>
        </div>
        <div className="text-center p-2 bg-blue-50 rounded-lg">
          <div className="text-lg font-bold text-[#D92327]">{verified}</div>
          <div className="text-xs text-[#EE2A2E]">Verified</div>
        </div>
      </div>
    </div>
  );
}
