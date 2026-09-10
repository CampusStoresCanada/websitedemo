import { formatMoney, type OrgPaymentSummary } from "@/lib/conference/org-payments";

/**
 * What the company has bought, and whether anything is still owed.
 *
 * The checklist has always carried a "Complete conference payment" task whose
 * link went to the bare org page, which shows nothing about conference money.
 * A company had no way to check the one thing the task asserts.
 *
 * Read-only on purpose. Paying happens through Stripe checkout at purchase
 * time, or by cheque and EFT arranged with the office — there is no "pay now"
 * to put here that would not be a lie about how this association actually
 * collects money.
 */
export default function OrgPayments({ summary }: { summary: OrgPaymentSummary }) {
  const { orders, outstanding, outstandingCents, currency } = summary;
  if (orders.length === 0) return null;

  return (
    <section id="payment" className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">Payment</h2>
        <p className="text-sm text-gray-500">
          {outstanding.length === 0
            ? "Nothing outstanding"
            : `${formatMoney(outstandingCents, currency)} outstanding`}
        </p>
      </div>

      {outstanding.length === 0 ? (
        <p className="mt-1 text-sm text-gray-600">
          Nothing outstanding for this conference. Everything below is paid.
        </p>
      ) : (
        <p className="mt-1 text-sm text-amber-900">
          {outstanding.length === 1 ? "One order is" : `${outstanding.length} orders are`} still
          awaiting payment. If you have paid by cheque or transfer it may not be recorded yet —
          contact{" "}
          <a href="mailto:info@campusstorescanada.ca" className="underline">
            info@campusstorescanada.ca
          </a>{" "}
          rather than paying twice.
        </p>
      )}

      <ul className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-200">
        {orders.map((order) => (
          <li key={order.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-gray-900">
                {order.bought.length > 0 ? order.bought.join(", ") : "Nothing itemised"}
              </p>
              {order.bought.length === 0 && (
                // Silence here reads as "a purchase"; naming it lets someone
                // ask the question. Varsity Collection has a $9,040 net order
                // with nothing attached to it.
                <p className="text-xs text-amber-800">
                  We can&rsquo;t show what this order covered — ask us and we&rsquo;ll check it.
                </p>
              )}
              <p className="text-xs text-gray-500">
                {new Date(order.orderedOn).toLocaleDateString("en-CA", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  timeZone: "America/Toronto",
                })}
                {order.taxCents > 0 ? ` · includes ${formatMoney(order.taxCents, order.currency)} tax` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium tabular-nums text-gray-900">
                {formatMoney(order.totalCents, order.currency)}
              </p>
              <StatusPill status={order.status} refundedCents={order.refundedCents} currency={order.currency} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusPill({
  status,
  refundedCents,
  currency,
}: {
  status: string;
  refundedCents: number;
  currency: string;
}) {
  if (status === "paid") {
    return <span className="text-xs font-medium text-green-700">Paid</span>;
  }
  if (status === "partially_refunded" || status === "refunded") {
    // The refund is the interesting number here — "paid" alone would hide a
    // change to what they actually hold.
    return (
      <span className="text-xs text-gray-600">
        Paid · {formatMoney(refundedCents, currency)} refunded
      </span>
    );
  }
  return <span className="text-xs font-medium text-amber-800">Awaiting payment</span>;
}
