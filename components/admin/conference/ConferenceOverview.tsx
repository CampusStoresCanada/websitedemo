"use client";

import { CONFERENCE_STATUS_LABELS, type ConferenceStatus } from "@/lib/constants/conference";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];

interface ConferenceOverviewProps {
  conference: ConferenceRow;
  forSaleCount: number;
}

export default function ConferenceOverview({ conference, forSaleCount }: ConferenceOverviewProps) {
  const statusLabel = CONFERENCE_STATUS_LABELS[conference.status as ConferenceStatus] ?? conference.status;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase font-medium">Status</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{statusLabel}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase font-medium">Things for sale</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{forSaleCount}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Details</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">Location</dt>
          <dd className="text-gray-900">
            {[conference.location_venue, conference.location_city, conference.location_province]
              .filter(Boolean)
              .join(", ") || "Not set"}
          </dd>
          <dt className="text-gray-500">Dates</dt>
          <dd className="text-gray-900">
            {conference.start_date && conference.end_date
              ? `${conference.start_date} – ${conference.end_date}`
              : "Not set"}
          </dd>
          <dt className="text-gray-500">Tax</dt>
          <dd className="text-gray-900">
            {conference.tax_jurisdiction
              ? `${conference.tax_jurisdiction} (${conference.tax_rate_pct ?? 0}%)`
              : "Not set"}
            {conference.stripe_tax_rate_id && (
              <span className="ml-2 text-xs font-mono text-gray-500">
                {conference.stripe_tax_rate_id}
              </span>
            )}
            {conference.tax_rate_pct && !conference.stripe_tax_rate_id && (
              <span className="ml-2 text-xs text-amber-600">
                Stripe tax rate not linked
              </span>
            )}
          </dd>
          <dt className="text-gray-500">Timezone</dt>
          <dd className="text-gray-900">{conference.timezone}</dd>
          {conference.duplicated_from_id && (
            <>
              <dt className="text-gray-500">Duplicated From</dt>
              <dd className="text-gray-900 font-mono text-xs">{conference.duplicated_from_id}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
