import Link from "next/link";
import { redirect } from "next/navigation";
import { isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { getConferenceOrderDetails } from "@/lib/actions/conference-commerce";
import { formatCents } from "@/lib/utils";
import OrderActions from "./order-actions";

export const metadata = { title: "Conference Order Details" };

export default async function ConferenceOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; edition: string; orderId: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { year, edition, orderId } = await params;
  const query = await searchParams;

  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const conferenceResult = await getPublicConference(parseInt(year, 10), edition);
  if (!conferenceResult.success || !conferenceResult.data) {
    return (
      <main className="max-w-4xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">Conference not found</h1>
      </main>
    );
  }

  const conference = conferenceResult.data;
  const detailsResult = await getConferenceOrderDetails(orderId);
  if (!detailsResult.success) {
    return (
      <main className="max-w-4xl mx-auto py-12 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="mt-2 text-sm text-red-600">{detailsResult.error}</p>
      </main>
    );
  }

  const { order, items } = detailsResult.data;
  const orgParam = query.org ? `?org=${query.org}` : "";

  return (
    <main className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
          <p className="text-sm text-gray-600">Order detail</p>
        </div>
        <Link
          href={`/conference/${year}/${edition}/orders${orgParam}`}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
        >
          Back to Orders
        </Link>
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">Order ID</dt>
          <dd className="font-mono text-xs text-gray-800">{order.id}</dd>
          <dt className="text-gray-500">Status</dt>
          <dd className="text-gray-800">{order.status}</dd>
          <dt className="text-gray-500">Created</dt>
          <dd className="text-gray-800">{new Date(order.created_at).toLocaleString()}</dd>
          <dt className="text-gray-500">Subtotal</dt>
          <dd className="text-gray-800">{formatCents(order.subtotal_cents)}</dd>
          <dt className="text-gray-500">Tax</dt>
          <dd className="text-gray-800">{formatCents(order.tax_cents)}</dd>
          <dt className="text-gray-500">Total</dt>
          <dd className="font-semibold text-gray-900">{formatCents(order.total_cents)}</dd>
        </dl>
      </div>

      <OrderActions
        orderId={order.id}
        orderStatus={order.status}
        canOverrideRefund={isGlobalAdmin(auth.ctx.globalRole)}
      />

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Product</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Slug</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Qty</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Unit</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Tax</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 text-sm text-gray-800">{item.product_name ?? "Unknown product"}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{item.product_slug ?? "n/a"}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{item.quantity}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{formatCents(item.unit_price_cents)}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{formatCents(item.tax_cents)}</td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{formatCents(item.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
