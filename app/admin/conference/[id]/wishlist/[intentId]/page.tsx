import Link from "next/link";

export const metadata = { title: "Wishlist Intent Detail | Admin" };

export default async function WishlistIntentDetailPage({
  params,
}: {
  params: Promise<{ id: string; intentId: string }>;
}) {
  const { id, intentId } = await params;

  return (
    <main>
      <div className="mb-4">
        <Link
          href={`/admin/conference/${id}/wishlist`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Wishlist
        </Link>
      </div>
      <h1 className="text-xl font-bold text-gray-900">Wishlist Intent</h1>
      <p className="mt-1 text-sm text-gray-500">Intent ID: {intentId}</p>
      <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
        Intent detail view coming soon — audit trail, status changes, and linked billing attempts.
      </div>
    </main>
  );
}
