"use client";

import { CONFERENCE_STATUS_LABELS, type ConferenceStatus } from "@/lib/constants/conference";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];
type ParamsRow = Database["public"]["Tables"]["conference_parameters"]["Row"];

interface ConferenceOverviewProps {
  conference: ConferenceRow;
  params: ParamsRow | null;
  productCount: number;
}

export default function ConferenceOverview({ conference, params, productCount }: ConferenceOverviewProps) {
  const statusLabel = CONFERENCE_STATUS_LABELS[conference.status as ConferenceStatus] ?? conference.status;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase font-medium">Status</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{statusLabel}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase font-medium">Products</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{productCount}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase font-medium">Meeting Suites</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">
            {params?.total_meeting_suites ?? "Not configured"}
          </div>
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

      {params && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Scheduling Parameters</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-gray-500">Conference Days</dt>
            <dd className="text-gray-900">{params.conference_days}</dd>
            <dt className="text-gray-500">Slots/Day</dt>
            <dd className="text-gray-900">{params.meeting_slots_per_day}</dd>
            <dt className="text-gray-500">Slot Duration</dt>
            <dd className="text-gray-900">{params.slot_duration_minutes} min</dd>
            <dt className="text-gray-500">Meeting Times</dt>
            <dd className="text-gray-900">
              {params.meeting_start_time} – {params.meeting_end_time}
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}
