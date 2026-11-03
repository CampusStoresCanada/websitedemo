"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertSeatToFunded,
  markCancollFirstInvoicePaid,
  type FundedConversionBoard,
} from "@/lib/actions/conference-funded-conversion";
import { formatCents } from "@/lib/utils";

/**
 * Staff list of schools whose paid registration can be cleared through to the
 * CANCOLL-funded one, one seat at a time. Nothing here runs on its own: every
 * switch is a click and a confirmation, and the whole list is locked until
 * CANCOLL's first invoice is recorded as paid.
 */
export default function FundedConversionPanel({
  conferenceId,
  board,
}: {
  conferenceId: string;
  board: FundedConversionBoard;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [paidOn, setPaidOn] = useState("");
  const locked = !board.firstInvoicePaidAt;

  const recordPaid = () => {
    if (!paidOn) return;
    if (!window.confirm(`Record CANCOLL's first invoice as paid on ${paidOn}? This unlocks refunds to schools.`)) return;
    startTransition(async () => {
      const result = await markCancollFirstInvoicePaid({ conferenceId, paidOn });
      setMessage(result.success ? { tone: "ok", text: "Recorded. Switches are unlocked." } : { tone: "error", text: result.error });
      if (result.success) router.refresh();
    });
  };

  const convert = (schoolName: string, seatId: string, holder: string | null, refundCents: number, viaStripe: boolean) => {
    const who = holder ?? "the unassigned seat";
    const how = viaStripe ? "to their card" : "by hand (this order wasn't paid through Stripe)";
    if (!window.confirm(`Switch ${who} at ${schoolName} to the CANCOLL-funded registration and refund ${formatCents(refundCents)} ${how}?`)) return;
    startTransition(async () => {
      const result = await convertSeatToFunded({ conferenceId, seatId });
      if (!result.success) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({
        tone: "ok",
        text:
          result.data.refunded === "stripe"
            ? `${schoolName} switched. ${formatCents(result.data.refundCents)} refunded to their card.`
            : `${schoolName} switched. Refund ${formatCents(result.data.refundCents)} to them by hand.`,
      });
      router.refresh();
    });
  };

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-semibold text-gray-900">CANCOLL-funded registrations</h2>
      <p className="mt-1 text-sm text-gray-600">
        Schools that qualify for CANCOLL funding but paid for their delegate. Switching keeps the same
        delegate on the seat, makes it the CANCOLL-funded registration, and refunds the school the fee
        and its tax. One per school.
      </p>

      {locked ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Locked until CANCOLL pays its first invoice. Schools are refunded only after that (MOU 5.5).</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-amber-900" htmlFor="cancoll-paid-on">Paid on</label>
            <input
              id="cancoll-paid-on"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={recordPaid}
              disabled={!paidOn || isPending}
              className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Record as paid
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-600">
          CANCOLL&apos;s first invoice paid on {board.firstInvoicePaidAt}.
          {board.claimDeadline && <> Switches close after {board.claimDeadline}.</>}
        </p>
      )}

      {message && (
        <p className={`mt-3 text-sm ${message.tone === "ok" ? "text-green-700" : "text-red-700"}`}>{message.text}</p>
      )}

      {board.schools.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No school can be switched right now.</p>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {board.schools.map((school) => (
            <li key={school.organizationId} className="py-2">
              <p className="text-sm font-medium text-gray-900">{school.organizationName}</p>
              <ul className="mt-1 space-y-1">
                {school.seats.map((seat) => (
                  <li key={seat.seatId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-gray-700">
                      {seat.holderName ?? "Unassigned seat"}
                      <span className="ml-2 text-gray-500">
                        refund {formatCents(seat.refundCents)} {seat.viaStripe ? "to card" : "by hand"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => convert(school.organizationName, seat.seatId, seat.holderName, seat.refundCents, seat.viaStripe)}
                      disabled={locked || isPending}
                      className="rounded-md border border-[#163D6D] px-3 py-1 text-xs font-semibold text-[#163D6D] hover:bg-[#163D6D] hover:text-white disabled:opacity-40"
                    >
                      Switch to CANCOLL
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
