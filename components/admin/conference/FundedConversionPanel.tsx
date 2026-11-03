"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertSeatToFunded,
  markCancollFirstInvoicePaid,
  type FundedConversionBoard,
} from "@/lib/actions/conference-funded-conversion";
import {
  exportCancollRegistrationReport,
  issueCancollInvoice,
  type CancollBillingSummary,
} from "@/lib/actions/cancoll-billing";
import { formatCents } from "@/lib/utils";

/** Hand a file the server built to the browser to save, as the War Room's Data tab does. */
function saveFile(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Staff list of schools whose paid registration can be cleared through to the
 * CANCOLL-funded one, one seat at a time. Nothing here runs on its own: every
 * switch is a click and a confirmation, and the whole list is locked until
 * CANCOLL's first invoice is recorded as paid.
 */
export default function FundedConversionPanel({
  conferenceId,
  board,
  billing,
}: {
  conferenceId: string;
  board: FundedConversionBoard;
  /** Where invoicing CANCOLL stands (lib/actions/cancoll-billing.ts). */
  billing: CancollBillingSummary | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [paidOn, setPaidOn] = useState("");
  // Schedule A's first invoice covers registrations confirmed on or before
  // November 30; the second, to January 17.
  const [throughDate, setThroughDate] = useState("2026-11-30");

  const downloadReport = () => {
    startTransition(async () => {
      const result = await exportCancollRegistrationReport(conferenceId);
      if (!result.success) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      saveFile(result.data.filename, result.data.csv);
    });
  };

  const invoice = () => {
    if (!billing) return;
    const cc = billing.invoiceCc.length ? `, copying ${billing.invoiceCc.join(" and ")}` : "";
    if (
      !window.confirm(
        `Invoice CANCOLL for every registration confirmed on or before ${throughDate} that hasn't been invoiced yet? ` +
          `It is emailed to ${billing.invoiceTo ?? "nobody"}${cc}, with the registration report attached, and sent to QuickBooks now.`
      )
    )
      return;
    startTransition(async () => {
      const result = await issueCancollInvoice({ conferenceId, throughDate });
      if (!result.success) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({
        tone: result.data.emailed ? "ok" : "error",
        text: result.data.emailed
          ? `Invoiced ${result.data.count} registrations, ${formatCents(result.data.totalCents)} with tax. Emailed and queued for QuickBooks.`
          : `Invoiced ${result.data.count} registrations, ${formatCents(result.data.totalCents)} with tax, and queued for QuickBooks, but the email didn't send. Send the invoice from Stripe.`,
      });
      router.refresh();
    });
  };
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

      {billing && (
        <div className="mt-4 rounded-md border border-gray-200 p-3 text-sm">
          <p className="font-medium text-gray-900">Invoicing CANCOLL</p>
          <p className="mt-1 text-gray-600">
            {billing.count} Supported Registration{billing.count === 1 ? "" : "s"} to date, {formatCents(billing.valueCents)} before
            tax. {billing.waiting} not invoiced yet.
          </p>
          {billing.invoices.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-gray-700">
              {billing.invoices.map((inv) => (
                <li key={inv.id}>
                  {inv.number ?? "Invoice"}: {inv.count} registration{inv.count === 1 ? "" : "s"}, {formatCents(inv.totalCents)},{" "}
                  {inv.status === "paid" ? "paid" : inv.status === "draft" ? "not sent" : "sent, unpaid"}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={downloadReport}
              disabled={isPending}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Download registration report (CSV)
            </button>
            <label className="ml-2 text-xs text-gray-600" htmlFor="cancoll-through">
              Confirmed on or before
            </label>
            <input
              id="cancoll-through"
              type="date"
              value={throughDate}
              onChange={(e) => setThroughDate(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={invoice}
              disabled={!throughDate || billing.waiting === 0 || !billing.invoiceTo || isPending}
              className="rounded-md bg-[#163D6D] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              Invoice CANCOLL
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {billing.invoiceTo
              ? <>Goes to {billing.invoiceTo}{billing.invoiceCc.length > 0 && <>, copying {billing.invoiceCc.join(" and ")}</>}.</>
              : "Nobody is set to receive CANCOLL's invoice yet."}{" "}
            Corrections go on the next invoice (MOU 11.4).
          </p>
        </div>
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
