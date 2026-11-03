"use client";

import { useState, useTransition } from "react";
import { setExpenseProgramQbo } from "@/lib/actions/expense-claims";
import QBAccountPicker from "@/components/admin/qbo/QBAccountPicker";
import QBTaxCodePicker from "@/components/admin/qbo/QBTaxCodePicker";

/**
 * Where one program's payables land in QuickBooks. Until an expense account is
 * set, approved claims wait in the queue and raise an alert rather than post
 * to a guessed account.
 */
export default function ExpenseProgramQbo({
  program,
}: {
  program: { id: string; name: string; qboExpenseAccountId: string | null; qboTaxCodeId: string | null };
}) {
  const [accountId, setAccountId] = useState(program.qboExpenseAccountId);
  const [taxCodeId, setTaxCodeId] = useState(program.qboTaxCodeId);
  const [status, setStatus] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await setExpenseProgramQbo({ programId: program.id, expenseAccountId: accountId, taxCodeId });
      setStatus(result.success ? "Saved." : result.error);
    });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
      <p className="font-semibold text-gray-900">{program.name}: QuickBooks</p>
      {!program.qboExpenseAccountId && (
        <p className="mt-1 text-amber-800">No expense account yet. Approved claims will wait until one is set.</p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <QBAccountPicker value={accountId} onChange={(id) => setAccountId(id)} label="Expense account" required />
        <QBTaxCodePicker value={taxCodeId} onChange={(id) => setTaxCodeId(id)} label="Tax code on bill lines" />
      </div>
      <button
        type="button"
        onClick={save}
        disabled={isPending}
        className="mt-3 rounded-md bg-[#163D6D] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
      >
        Save
      </button>
      {status && <span className="ml-3 text-gray-600">{status}</span>}
    </div>
  );
}
