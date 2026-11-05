"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveExpenseLine, saveExpensePayee, submitExpenseClaim } from "@/lib/actions/expense-claims";
import type { ExpenseClaimView } from "@/lib/expenses/claims";
import {
  CLAIM_STATUS_LABELS,
  PAYEE_TYPE_LABELS,
  claimGaps,
  claimTotals,
  distanceAmountCents,
  formatCents,
  lineIsFilled,
  type ExpenseCategory,
  type ExpenseLine,
  type Payee,
  type PayeeField,
} from "@/lib/expenses/rules";
import ReceiptList from "./ReceiptList";

const emptyLine = (key: string): ExpenseLine => ({
  categoryKey: key,
  amountCents: 0,
  taxCents: 0,
  distanceKm: null,
  description: null,
  receiptCount: 0,
});

/** "123.45" → 12345. Blank is zero; anything else unparseable is NaN. */
function toCents(text: string): number {
  const t = text.replace(/[$,\s]/g, "");
  if (t === "") return 0;
  return /^\d+(\.\d{0,2})?$/.test(t) ? Math.round(parseFloat(t) * 100) : NaN;
}
const dollars = (cents: number) => (cents ? (cents / 100).toFixed(2) : "");

/**
 * An expense claim, for any program. Slots come from the program's categories;
 * categories sharing a choice group are offered as either/or. Every answer
 * saves as it is given, so a colleague who opens the claim next sees where it
 * stands.
 */
export default function ExpenseClaimForm({ view }: { view: ExpenseClaimView }) {
  const router = useRouter();
  const [lines, setLines] = useState<Record<string, ExpenseLine>>(() =>
    Object.fromEntries(view.categories.map((c) => [c.key, view.lines.find((l) => l.categoryKey === c.key) ?? emptyLine(c.key)]))
  );
  const [payee, setPayee] = useState<Payee>(view.payee);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Set on a successful submit, so the form locks at once rather than waiting
  // on the refresh to bring the new status back.
  const [submitted, setSubmitted] = useState(false);
  const status = submitted ? "submitted" : view.status;
  const editable = view.canEdit && !submitted;

  // Alternatives (airfare OR mileage): which one is chosen. Starts on whichever
  // already has something in it.
  const groups = new Map<string, ExpenseCategory[]>();
  for (const c of view.categories) if (c.choiceGroup) groups.set(c.choiceGroup, [...(groups.get(c.choiceGroup) ?? []), c]);
  const [chosen, setChosen] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(
      [...groups].map(([g, cats]) => [g, cats.find((c) => lineIsFilled(lines[c.key]))?.key ?? null])
    )
  );

  // Saves run one after another, as on the bursary request form.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = (work: () => Promise<string | null>) => {
    setError(null);
    setSaved(false);
    queue.current = queue.current.then(async () => {
      const problem = await work();
      if (problem) setError(problem);
      else setSaved(true);
    });
  };

  const saveLine = (key: string, next: ExpenseLine) => {
    const category = view.categories.find((c) => c.key === key)!;
    if (category.measure === "distance") {
      next = { ...next, taxCents: 0, amountCents: distanceAmountCents(next.distanceKm ?? 0, category.rateCentsPerKm ?? 0) };
    }
    if (Number.isNaN(next.amountCents) || Number.isNaN(next.taxCents)) {
      setError("Enter amounts in dollars and cents, like 245.60.");
      return;
    }
    setLines((cur) => ({ ...cur, [key]: next }));
    enqueue(async () => {
      const result = await saveExpenseLine({
        claimId: view.id,
        categoryKey: key,
        amountCents: next.amountCents,
        taxCents: next.taxCents,
        distanceKm: next.distanceKm,
        description: next.description,
      });
      return result.success ? null : result.error;
    });
  };

  const choose = (group: string, key: string) => {
    const previous = chosen[group];
    if (previous && previous !== key && lineIsFilled(lines[previous])) {
      const label = view.categories.find((c) => c.key === previous)?.label;
      if (!window.confirm(`Switch away from ${label}? What you entered for it will be cleared.`)) return;
      saveLine(previous, { ...emptyLine(previous), receiptCount: lines[previous].receiptCount });
    }
    setChosen((cur) => ({ ...cur, [group]: key }));
  };

  const savePayee = (field: PayeeField, value: string | null) => {
    setPayee((cur) => ({ ...cur, [field]: value }));
    enqueue(async () => {
      const result = await saveExpensePayee({ claimId: view.id, field, value });
      return result.success ? null : result.error;
    });
  };

  const choosePayee = (type: string) => {
    savePayee("type", type);
    // The institution's name is the obvious payee name; start it there.
    if (type === "organization" && !payee.name) savePayee("name", view.organizationName);
  };

  const submit = () =>
    startTransition(async () => {
      await queue.current;
      const result = await submitExpenseClaim(view.id);
      if (!result.success) return setError(result.error);
      setSubmitted(true);
      router.refresh();
    });

  const currentLines = view.categories.map((c) => ({
    ...lines[c.key],
    receiptCount: view.receiptsByCategory[c.key]?.length ?? 0,
  }));
  const gaps = claimGaps({ categories: view.categories, lines: currentLines, payee });
  const totals = claimTotals(currentLines.filter(lineIsFilled));
  const shown = view.categories.filter((c) => !c.choiceGroup || chosen[c.choiceGroup] === c.key || !editable);

  return (
    <div className="space-y-6 text-sm text-gray-800">
      <div>
        <p className="font-medium text-gray-900">{CLAIM_STATUS_LABELS[status]}</p>
        {view.closesOnLabel && editable && <p className="text-gray-600">Claims close at the end of {view.closesOnLabel}.</p>}
        {!view.windowOpen && status === "draft" && <p className="text-gray-600">Claims aren&apos;t open right now.</p>}
        {view.decisionNote && !submitted && (status === "returned" || status === "rejected") && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">{view.decisionNote}</p>
        )}
      </div>

      {editable &&
        [...groups].map(([group, cats]) => (
          <fieldset key={group}>
            <legend className="font-medium text-gray-900">Choose one</legend>
            {cats.map((c) => (
              <label key={c.key} className="mt-1 flex items-center gap-2">
                <input type="radio" name={`group-${group}`} checked={chosen[group] === c.key} onChange={() => choose(group, c.key)} />
                {c.label}
              </label>
            ))}
          </fieldset>
        ))}

      {shown.map((c) => {
        const line = lines[c.key];
        if (!editable && !lineIsFilled(line)) return null;
        return (
          <section key={c.key} className="rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900">{c.label}</h3>
            {c.help && <p className="text-gray-600">{c.help}</p>}
            <fieldset disabled={!editable} className="mt-3 grid gap-3 sm:grid-cols-2">
              {c.measure === "distance" ? (
                <label className="block">
                  Total kilometres
                  <input
                    inputMode="decimal"
                    defaultValue={line.distanceKm ?? ""}
                    onBlur={(e) => {
                      const km = e.target.value.trim() === "" ? null : Number(e.target.value);
                      if (km !== null && (!Number.isFinite(km) || km < 0)) return setError("Enter kilometres as a number.");
                      if (km !== line.distanceKm) saveLine(c.key, { ...line, distanceKm: km });
                    }}
                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5"
                  />
                </label>
              ) : (
                <>
                  <label className="block">
                    Amount before tax ($)
                    <input
                      inputMode="decimal"
                      defaultValue={dollars(line.amountCents)}
                      onBlur={(e) => {
                        const cents = toCents(e.target.value);
                        if (cents !== line.amountCents) saveLine(c.key, { ...line, amountCents: cents });
                      }}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5"
                    />
                  </label>
                  <label className="block">
                    Tax paid ($)
                    <input
                      inputMode="decimal"
                      defaultValue={dollars(line.taxCents)}
                      onBlur={(e) => {
                        const cents = toCents(e.target.value);
                        if (cents !== line.taxCents) saveLine(c.key, { ...line, taxCents: cents });
                      }}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5"
                    />
                  </label>
                </>
              )}
              <label className="block sm:col-span-2">
                {c.measure === "distance" ? "Route (from and to)" : "Notes (optional)"}
                <input
                  defaultValue={line.description ?? ""}
                  onBlur={(e) => {
                    const text = e.target.value.trim() || null;
                    if (text !== line.description) saveLine(c.key, { ...line, description: text });
                  }}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5"
                />
              </label>
            </fieldset>
            <p className="mt-2 text-gray-700">
              {c.measure === "distance"
                ? `${line.distanceKm ?? 0} km × ${formatCents(c.rateCentsPerKm ?? 0)} = ${formatCents(line.amountCents)}`
                : `Total ${formatCents(line.amountCents + line.taxCents)}`}
            </p>
            {c.requiresReceipt && (
              <ReceiptList
                claimId={view.id}
                categoryKey={c.key}
                receipts={view.receiptsByCategory[c.key] ?? []}
                editable={editable}
                onChanged={() => router.refresh()}
              />
            )}
          </section>
        );
      })}

      <section className="rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900">Who are we paying?</h3>
        <fieldset disabled={!editable} className="mt-2 space-y-3">
          <div>
            {view.program.payeeTypes.map((t) => (
              <label key={t} className="mt-1 flex items-center gap-2">
                <input type="radio" name="payee-type" checked={payee.type === t} onChange={() => choosePayee(t)} />
                {PAYEE_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
          {payee.type && (
            <div className="grid gap-3 sm:grid-cols-2">
              <PayeeInput label="Pay to (name)" field="name" payee={payee} onSave={savePayee} wide />
              <PayeeInput label="Email" field="email" payee={payee} onSave={savePayee} />
              <PayeeInput label="Phone (optional)" field="phone" payee={payee} onSave={savePayee} />
              <PayeeInput label="Mailing address" field="addressLine1" payee={payee} onSave={savePayee} wide />
              <PayeeInput label="Address line 2 (optional)" field="addressLine2" payee={payee} onSave={savePayee} wide />
              <PayeeInput label="City" field="city" payee={payee} onSave={savePayee} />
              <PayeeInput label="Province" field="province" payee={payee} onSave={savePayee} />
              <PayeeInput label="Postal code" field="postalCode" payee={payee} onSave={savePayee} />
              <PayeeInput label="Country" field="country" payee={payee} onSave={savePayee} />
            </div>
          )}
        </fieldset>
      </section>

      <p className="font-medium text-gray-900">
        Claim total {formatCents(totals.totalCents)}{" "}
        <span className="font-normal text-gray-600">
          ({formatCents(totals.amountCents)} + {formatCents(totals.taxCents)} tax)
        </span>
      </p>

      {error && <p className="text-red-700">{error}</p>}
      {saved && !error && editable && <p className="text-gray-500">Saved.</p>}

      {editable && (
        <div>
          {gaps.length > 0 && (
            <ul className="mb-2 list-disc pl-5 text-gray-600">
              {gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={gaps.length > 0 || isPending}
            className="rounded-md bg-[#163D6D] px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {status === "returned" ? "Resubmit claim" : "Submit claim"}
          </button>
        </div>
      )}
    </div>
  );
}

function PayeeInput({
  label,
  field,
  payee,
  onSave,
  wide,
}: {
  label: string;
  field: PayeeField;
  payee: Payee;
  onSave: (field: PayeeField, value: string | null) => void;
  wide?: boolean;
}) {
  const value = payee[field] ?? "";
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input
        key={value}
        defaultValue={value}
        type={field === "email" ? "email" : "text"}
        onBlur={(e) => {
          const next = e.target.value.trim() || null;
          if (next !== (payee[field] ?? null)) onSave(field, next);
        }}
        className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5"
      />
    </label>
  );
}
