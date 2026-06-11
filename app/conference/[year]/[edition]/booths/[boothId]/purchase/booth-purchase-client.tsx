"use client";

import { useState, useEffect, useTransition } from "react";
import {
  createBoothSetupIntent,
  reserveBooth,
  submitBoothPurchaseRequest,
} from "@/lib/actions/conference-booths";

type LineItem = {
  slug: string;
  name: string;
  amount_cents: number;
  booth_number?: string;
  booth_id?: string;
};

type Props = {
  boothId: string;
  boothNumber: string;
  orgId: string;
  orgName: string;
  conferenceId: string;
  year: string;
  edition: string;
  lineItems: LineItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

type Step = "method" | "card" | "po" | "submitting" | "confirmed";

export default function BoothPurchaseClient({
  boothId,
  boothNumber,
  orgId,
  conferenceId,
  year,
  edition,
  lineItems,
  subtotalCents,
  taxCents,
  totalCents,
}: Props) {
  const [step, setStep] = useState<Step>("method");
  const [paymentType, setPaymentType] = useState<"card" | "po" | null>(null);
  const [poNumber, setPoNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Reserve the booth as soon as this page loads
  useEffect(() => {
    reserveBooth(boothId, orgId).catch(() => {
      // silently ignore — page.tsx already verified status === 'available'
    });
  }, [boothId, orgId]);

  function handleSelectMethod(method: "card" | "po") {
    setPaymentType(method);
    setError(null);
    setStep(method);
  }

  async function handleCardSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      // 1. Create Stripe SetupIntent to collect card (off-session)
      const intentResult = await createBoothSetupIntent(orgId);
      if (!intentResult.success || !intentResult.clientSecret) {
        setError(intentResult.error ?? "Could not initiate payment.");
        return;
      }

      // In a real integration, Stripe Elements would confirm the SetupIntent
      // client-side using intentResult.clientSecret, then the confirmed
      // payment_method id is passed back. For now we submit without an actual
      // Stripe element — the admin will manually collect card details until
      // Stripe Elements is wired into this form.

      const result = await submitBoothPurchaseRequest({
        boothId,
        orgId,
        conferenceId,
        lineItems,
        subtotalCents,
        taxCents,
        totalCents,
        paymentType: "card",
        stripeCustomerId: intentResult.customerId,
        stripeSetupIntentId: intentResult.clientSecret.split("_secret_")[0],
      });

      if (!result.success) {
        setError(result.error ?? "Submission failed.");
        return;
      }

      setApprovalId(result.approvalId ?? null);
      setStep("confirmed");
    });
  }

  async function handlePoSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!poNumber.trim()) {
      setError("Please enter a PO number.");
      return;
    }

    startTransition(async () => {
      // For PO: still create a Stripe customer + SetupIntent for the card-on-file
      const intentResult = await createBoothSetupIntent(orgId);
      if (!intentResult.success) {
        setError(intentResult.error ?? "Could not set up payment.");
        return;
      }

      const result = await submitBoothPurchaseRequest({
        boothId,
        orgId,
        conferenceId,
        lineItems,
        subtotalCents,
        taxCents,
        totalCents,
        paymentType: "po",
        stripeCustomerId: intentResult.customerId,
        stripeSetupIntentId: intentResult.clientSecret?.split("_secret_")[0],
        poNumber: poNumber.trim(),
      });

      if (!result.success) {
        setError(result.error ?? "Submission failed.");
        return;
      }

      setApprovalId(result.approvalId ?? null);
      setStep("confirmed");
    });
  }

  if (step === "confirmed") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center space-y-3">
        <div className="text-2xl">✓</div>
        <h2 className="text-lg font-semibold text-green-900">Request Submitted</h2>
        <p className="text-sm text-green-800">
          Booth {boothNumber} is held for your organization. Two CSC administrators will
          review your request — you will be notified once approved and your card is
          charged.
        </p>
        {approvalId && (
          <p className="text-xs text-green-600 font-mono">Reference: {approvalId}</p>
        )}
        <div className="pt-2">
          <a
            href={`/conference/${year}/${edition}/booths`}
            className="text-sm text-green-700 underline hover:text-green-900"
          >
            Return to floor plan
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Payment</h2>

      <p className="text-xs text-gray-500">
        Your card will <strong>not</strong> be charged immediately. Two CSC administrators
        must approve your request before the charge is processed.
        {paymentType === "po" &&
          " For PO purchases, the card on file is charged 30 days after submission."}
      </p>

      {step === "method" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => handleSelectMethod("card")}
            className="rounded-lg border border-gray-200 p-4 text-left hover:border-[#EE2A2E] hover:bg-[#fff8f8] transition-colors"
          >
            <div className="font-semibold text-gray-900">Credit / Debit Card</div>
            <div className="mt-1 text-xs text-gray-500">
              Card is charged after admin approval.
            </div>
          </button>
          <button
            type="button"
            onClick={() => handleSelectMethod("po")}
            className="rounded-lg border border-gray-200 p-4 text-left hover:border-[#EE2A2E] hover:bg-[#fff8f8] transition-colors"
          >
            <div className="font-semibold text-gray-900">Purchase Order</div>
            <div className="mt-1 text-xs text-gray-500">
              Card on file charged 30 days after submission.
            </div>
          </button>
        </div>
      )}

      {step === "card" && (
        <form onSubmit={handleCardSubmit} className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            {/* Placeholder for Stripe Elements */}
            <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400">
              [Stripe Card Element will be embedded here]
              <br />
              <span className="text-xs">
                Wire in @stripe/react-stripe-js with the client secret from createBoothSetupIntent
              </span>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("method")}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Submitting..." : `Submit Request — $${(totalCents / 100).toFixed(2)}`}
            </button>
          </div>
        </form>
      )}

      {step === "po" && (
        <form onSubmit={handlePoSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              PO Number
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="e.g. PO-2026-1234"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#EE2A2E] focus:outline-none"
              />
            </label>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-700 mb-2">Card on File</p>
            <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400">
              [Stripe Card Element — card saved for deferred charge]
            </div>
          </div>

          <p className="text-xs text-amber-700">
            The card above will be charged approximately 30 days after admin approval,
            unless your organization remits payment by another method before that date.
          </p>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("method")}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Submitting..." : "Submit PO Request"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
