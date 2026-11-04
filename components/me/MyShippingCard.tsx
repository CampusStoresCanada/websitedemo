"use client";

/**
 * "Ship your boxes home" on /me: the shipping desk's form, for yourself. We
 * already know who you are and where your institution is, so it starts filled
 * in. Labels print at the shipping desk; you bring the boxes there.
 */

import { useState } from "react";
import { listMyShipments } from "@/lib/actions/conference-shipping";
import type { DeskShipment, Shipper } from "@/lib/conference/shipping";
import ShipmentForm, { ShipmentList } from "@/components/conference/ShipmentForm";

export default function MyShippingCard({
  conferenceId,
  shipper,
  initialShipments,
}: {
  conferenceId: string;
  shipper: Shipper;
  initialShipments: DeskShipment[];
}) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [shipments, setShipments] = useState(initialShipments);

  const refresh = async () => {
    const res = await listMyShipments({ conferenceId, personId: shipper.personId });
    if (res.success) setShipments(res.data);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Ship your boxes home</h3>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-sm font-medium text-[#163D6D] hover:underline"
          >
            Ship boxes &rarr;
          </button>
        ) : null}
      </div>
      {!open ? (
        <p className="mt-1 text-sm text-gray-600">
          Book Purolator here, then bring your boxes to the shipping desk. Your labels print there.
        </p>
      ) : (
        <div className="mt-4">
          <ShipmentForm
            key={round}
            conferenceId={conferenceId}
            shipper={shipper}
            canQuote
            labelsNote={(n) =>
              n === 1
                ? "Bring your box to the shipping desk. Your label prints there."
                : `Bring your ${n} boxes to the shipping desk. Your labels print there, one per box.`
            }
            finishLabel="Done"
            onBooked={() => void refresh()}
            onFinish={() => {
              setOpen(false);
              setRound((r) => r + 1);
            }}
          />
        </div>
      )}
      {shipments.length > 0 ? (
        <div className="mt-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Your shipments</h4>
          <ShipmentList conferenceId={conferenceId} shipments={shipments} showPerson={false} onChanged={refresh} />
        </div>
      ) : null}
    </div>
  );
}
