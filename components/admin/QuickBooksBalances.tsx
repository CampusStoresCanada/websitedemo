"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/utils";
import { billQuickBooksBalance } from "@/lib/actions/quickbooks-balances";
import type { QuickBooksBalance } from "@/lib/billing/quickbooks-balances";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08-05" as "August 5, 2026", without passing through a timezone. */
function longDate(ymd: string | null): string | null {
  const m = ymd?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null;
}

function defaultDescription(b: QuickBooksBalance): string {
  const date = longDate(b.txnDate);
  return date ? `Balance owing on your invoice of ${date}` : "Balance owing on your invoice";
}

const STATE_NOTE: Record<Exclude<QuickBooksBalance["state"], "billable">, string> = {
  billed: "Already billed on the site",
  billed_differs: "Open on the site for a different amount",
  no_org: "No organization linked to this QuickBooks customer",
  other_currency: "Not in Canadian dollars",
};

export default function QuickBooksBalances({ balances }: { balances: QuickBooksBalance[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (balances.length === 0) {
    return <p className="text-sm text-gray-600">QuickBooks shows nothing owing.</p>;
  }

  const billable = balances.filter((b) => b.state === "billable");
  const total = balances.reduce((sum, b) => sum + b.owingCents, 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">
        {balances.length} {balances.length === 1 ? "invoice" : "invoices"} owing {formatCents(total)} in QuickBooks.{" "}
        {billable.length === 0
          ? "The site has an open invoice for every one it can bill."
          : `${billable.length} ${billable.length === 1 ? "has" : "have"} no open invoice on the site.`}
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Organization</th>
              <th className="px-3 py-2">QuickBooks invoice</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Owing</th>
              <th className="px-3 py-2">On the site</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {balances.map((b) => (
              <BalanceRow
                key={b.qboInvoiceId}
                balance={b}
                open={openId === b.qboInvoiceId}
                onToggle={() => setOpenId(openId === b.qboInvoiceId ? null : b.qboInvoiceId)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BalanceRow({
  balance: b,
  open,
  onToggle,
}: {
  balance: QuickBooksBalance;
  open: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(() => defaultDescription(b));
  const [dueDate, setDueDate] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function bill() {
    setBusy(true);
    setError(null);
    const result = await billQuickBooksBalance({ qboInvoiceId: b.qboInvoiceId, description, dueDate, notify });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onToggle();
    router.refresh();
  }

  return (
    <>
      <tr>
        <td className="px-3 py-2">
          {b.org ? (
            <Link href={`/org/billing?org=${b.org.id}`} className="font-medium text-[#163D6D] hover:underline">
              {b.org.name}
            </Link>
          ) : (
            <span className="text-gray-500">None</span>
          )}
          {b.customerName && b.customerName !== b.org?.name ? (
            <div className="text-xs text-gray-500">QuickBooks: {b.customerName}</div>
          ) : null}
        </td>
        <td className="px-3 py-2 text-gray-700">
          {b.docNumber ?? `#${b.qboInvoiceId}`}
          {b.txnDate ? <div className="text-xs text-gray-500">{longDate(b.txnDate)}</div> : null}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gray-700">{formatCents(b.totalCents)}</td>
        <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{formatCents(b.owingCents)}</td>
        <td className="px-3 py-2 text-gray-700">
          {b.state === "billable" ? (
            b.original ? (
              `Shows as ${b.original.status}, ${formatCents(b.original.totalCents)}`
            ) : (
              "No record of this invoice"
            )
          ) : (
            <>
              {STATE_NOTE[b.state]}
              {b.openOnSite ? `: ${formatCents(b.openOnSite.totalCents)}` : ""}
            </>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {b.state === "billable" ? (
            <button
              type="button"
              onClick={onToggle}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {open ? "Close" : `Bill ${formatCents(b.owingCents)}`}
            </button>
          ) : null}
        </td>
      </tr>
      {open && b.state === "billable" ? (
        <tr className="bg-gray-50">
          <td colSpan={6} className="px-3 py-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="block text-xs font-medium text-gray-700">
                What the invoice says
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-xs font-medium text-gray-700">
                Due date
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="mt-1 block rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
                <span className="mt-1 block font-normal text-gray-500">Blank is 30 days.</span>
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Email {b.org?.name}&rsquo;s admins that it is ready
            </label>
            <p className="mt-2 text-xs text-gray-500">
              The amount is what QuickBooks shows owing. When it is paid, the payment goes against QuickBooks invoice{" "}
              {b.docNumber ?? `#${b.qboInvoiceId}`}; no new invoice is posted there.
            </p>
            {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
            <button
              type="button"
              onClick={bill}
              disabled={busy || !description.trim()}
              className="mt-3 rounded-md bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Issuing…" : `Issue invoice for ${formatCents(b.owingCents)}`}
            </button>
          </td>
        </tr>
      ) : null}
    </>
  );
}
