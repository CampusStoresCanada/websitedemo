"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveExpenseClaim, decideExpenseClaim } from "@/lib/actions/expense-claims";
import type { ExpenseClaimView } from "@/lib/expenses/claims";
import { CLAIM_STATUS_LABELS, PAYEE_TYPE_LABELS, formatCents, lineIsFilled } from "@/lib/expenses/rules";
import ReceiptList from "@/components/expenses/ReceiptList";

/**
 * One claim, as an approver sees it: who it pays, every expense with its tax
 * and receipts, the approvals so far, and the three decisions. Whether this
 * person may approve is the database's call (approve_expense_claim), so a
 * refusal comes back as a sentence rather than a hidden button.
 */
export default function ExpenseClaimReview({ claim }: { claim: ExpenseClaimView }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const waiting = claim.status === "submitted";
  const p = claim.payee;

  const approve = () =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await approveExpenseClaim(claim.id);
      if (!result.success) return setError(result.error);
      setMessage(
        result.data.outcome === "approved"
          ? "Approved. It's queued for QuickBooks as a payable."
          : "Your approval is recorded. It needs one more approver."
      );
      router.refresh();
    });

  const decide = (decision: "returned" | "rejected") =>
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await decideExpenseClaim({ claimId: claim.id, decision, note });
      if (!result.success) return setError(result.error);
      setNote("");
      router.refresh();
    });

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-800">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{claim.organizationName}</h2>
          <p className="text-gray-500">{claim.program.name}</p>
        </div>
        <p className="font-medium">
          {CLAIM_STATUS_LABELS[claim.status]}
          {claim.qboBillId && <span className="ml-2 text-gray-500">QuickBooks bill {claim.qboBillId}</span>}
        </p>
      </header>

      <table className="mt-4 w-full text-left">
        <thead className="text-xs uppercase text-gray-500">
          <tr>
            <th className="py-1">Expense</th>
            <th className="py-1 text-right">Before tax</th>
            <th className="py-1 text-right">Tax</th>
            <th className="py-1 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {claim.categories.map((c) => {
            const line = claim.lines.find((l) => l.categoryKey === c.key);
            if (!line || !lineIsFilled(line)) return null;
            return (
              <tr key={c.key} className="border-t border-gray-100 align-top">
                <td className="py-2">
                  <p className="font-medium">{c.label}</p>
                  {c.measure === "distance" && (
                    <p className="text-gray-500">
                      {line.distanceKm} km × {formatCents(c.rateCentsPerKm ?? 0)}
                    </p>
                  )}
                  {line.description && <p className="text-gray-500">{line.description}</p>}
                  {c.requiresReceipt && (
                    <ReceiptList
                      claimId={claim.id}
                      categoryKey={c.key}
                      receipts={claim.receiptsByCategory[c.key] ?? []}
                      editable={false}
                    />
                  )}
                </td>
                <td className="py-2 text-right">{formatCents(line.amountCents)}</td>
                <td className="py-2 text-right">{formatCents(line.taxCents)}</td>
                <td className="py-2 text-right">{formatCents(line.amountCents + line.taxCents)}</td>
              </tr>
            );
          })}
          <tr className="border-t border-gray-300 font-semibold">
            <td className="py-2">Claim total</td>
            <td className="py-2 text-right">{formatCents(claim.totals.amountCents)}</td>
            <td className="py-2 text-right">{formatCents(claim.totals.taxCents)}</td>
            <td className="py-2 text-right">{formatCents(claim.totals.totalCents)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 grid gap-1">
        <p className="font-medium text-gray-900">Pay to: {p.type ? PAYEE_TYPE_LABELS[p.type] : "Not chosen"}</p>
        <p>{p.name}</p>
        <p>
          {[p.addressLine1, p.addressLine2].filter(Boolean).join(", ")}
          {p.city && `, ${p.city}`}
          {p.province && ` ${p.province}`}
          {p.postalCode && ` ${p.postalCode}`}
          {p.country && `, ${p.country}`}
        </p>
        <p className="text-gray-600">{[p.email, p.phone].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="mt-4 text-gray-700">
        <p>
          Approvals: {claim.approvals.length} of {claim.program.approvalsRequired}
          {claim.approvals.length > 0 && <> ({claim.approvals.map((a) => a.approverName).join(", ")})</>}
        </p>
        {claim.decisionNote && <p className="mt-1">Note to the claimant: {claim.decisionNote}</p>}
      </div>

      {waiting && (
        <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={approve}
            disabled={isPending}
            className="rounded-md bg-[#163D6D] px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Approve
          </button>
          <div>
            <label className="block text-gray-700">
              Note to the claimant (needed to send back or decline)
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5"
              />
            </label>
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={() => decide("returned")} disabled={isPending} className="text-[#163D6D] underline">
                Send back for changes
              </button>
              <button type="button" onClick={() => decide("rejected")} disabled={isPending} className="text-red-700 underline">
                Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {message && <p className="mt-3 text-green-700">{message}</p>}
      {error && <p className="mt-3 text-red-700">{error}</p>}
    </article>
  );
}
