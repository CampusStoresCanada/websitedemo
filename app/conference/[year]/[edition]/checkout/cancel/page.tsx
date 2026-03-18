import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";

export const metadata = { title: "Checkout Canceled" };

export default async function ConferenceCheckoutCancelPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; edition: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { year, edition } = await params;
  const query = await searchParams;

  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const conferenceResult = await getPublicConference(parseInt(year, 10), edition);
  const conferenceName = conferenceResult.success && conferenceResult.data
    ? conferenceResult.data.name
    : "Conference";

  const orgParam = query.org ? `?org=${query.org}` : "";

  return (
    <main className="max-w-3xl mx-auto py-12 px-4 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
        <svg className="h-7 w-7 text-amber-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold text-gray-900">Checkout canceled</h1>
      <p className="mt-2 text-sm text-gray-600">
        No payment was captured for <strong>{conferenceName}</strong>. Your cart is still available.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link
          href={`/conference/${year}/${edition}/cart${orgParam}`}
          className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
        >
          Return to Cart
        </Link>
        <Link
          href={`/conference/${year}/${edition}/products${orgParam}`}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
        >
          Back to Products
        </Link>
      </div>
    </main>
  );
}
