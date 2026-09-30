"use client";

import { useState } from "react";
import { setServiceStatus } from "@/lib/actions/benchmarking-profile";
import { SERVICE_STATUSES, type ServiceStatus } from "@/lib/benchmarking/key-dates";
import { STORE_SERVICES } from "@/lib/types/procurement";

/**
 * Services and operations, with where each one is going.
 *
 * A yes/no list says what exists today. It cannot show that three stores are
 * dropping lottery tickets while four are adding lockers, which is the shape
 * worth knowing — ICBA asks it this way and they are right to.
 *
 * What is CURRENTLY offered syncs to the store's public procurement profile.
 * A plan is not a fact, so plans stay here.
 */
export default function ServicesJourney({
  benchmarkingId,
  initialStatus,
  isReadOnly,
}: {
  benchmarkingId: string;
  initialStatus: Record<string, ServiceStatus>;
  isReadOnly: boolean;
}) {
  const [status, setStatus] = useState<Record<string, ServiceStatus>>(initialStatus);
  const [error, setError] = useState<string | null>(null);

  async function choose(service: string, value: ServiceStatus) {
    const previous = status[service];
    setStatus((p) => ({ ...p, [service]: value }));
    const res = await setServiceStatus({ benchmarkingId, service, status: value });
    if (!res.success) {
      setStatus((p) => ({ ...p, [service]: previous }));
      setError(res.error ?? "Could not save that.");
    }
  }

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-gray-900">Services and operations</h3>
      <p className="mt-1 text-xs text-gray-600">
        Not just what you run today, but what you are planning to add or stop. Anything
        marked as currently offered appears on your store&apos;s profile for vendor
        partners; plans stay between you and CSC.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th className="py-2 pr-3 text-xs font-medium text-gray-500">Service</th>
              {SERVICE_STATUSES.map((s) => (
                <th
                  key={s.value}
                  className="px-2 py-2 text-center text-xs font-medium text-gray-500"
                >
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STORE_SERVICES.map((service) => (
              <tr key={service} className="border-b border-gray-100">
                <td className="py-2 pr-3 text-gray-800">{service}</td>
                {SERVICE_STATUSES.map((s) => (
                  <td key={s.value} className="px-2 py-2 text-center">
                    <input
                      type="radio"
                      name={`svc-${service}`}
                      checked={status[service] === s.value}
                      disabled={isReadOnly}
                      onChange={() => void choose(service, s.value)}
                      aria-label={`${service}: ${s.label}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
