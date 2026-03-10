import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";

export const metadata = { title: "Checkout Success" };

export default async function ConferenceCheckoutSuccessPage({
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
  if (!conferenceResult.success || !conferenceResult.data) {
    return (
      <main className="max-w-3xl mx-auto py-12 px-4 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Payment completed</h1>
        <p className="mt-2 text-sm text-gray-600">Your payment went through, but conference details could not be loaded.</p>
      </main>
    );
  }

  const conference = conferenceResult.data;
  const orgParam = query.org ? `?org=${query.org}` : "";

  return (
    <main className="max-w-3xl mx-auto py-12 px-4 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
        <svg className="h-7 w-7 text-green-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold text-gray-900">Checkout complete</h1>
      <p className="mt-2 text-sm text-gray-600">
        Payment for <strong>{conference.name}</strong> was submitted. It may take a few seconds for order status to finalize.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link
          href={`/conference/${year}/${edition}/products${orgParam}`}
          className="rounded-md bg-[#D60001] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
        >
          Continue Shopping
        </Link>
        <Link
          href={`/conference/${year}/${edition}/cart${orgParam}`}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
        >
          View Cart
        </Link>
        <Link
          href={`/conference/${year}/${edition}/register`}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
        >
          Go to Registration
        </Link>
      </div>
    </main>
  );
}
