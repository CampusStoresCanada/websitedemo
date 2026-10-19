import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated, isConferenceDeskStaff } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import { loginWithNext } from "@/lib/auth/login-redirect";

export const metadata = { title: "Checkout Canceled" };

export default async function ConferenceCheckoutCancelPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; edition: string }>;
  /** `desk`: a sale started at this conference's check-in desk (its id). */
  searchParams: Promise<{ org?: string; desk?: string }>;
}) {
  const { year, edition } = await params;
  const query = await searchParams;

  const auth = await requireAuthenticated();
  // ⛔ Same split as the success page: the desk's own staff (a hand-over that
  // came back unpaid) return to the desk, which stays locked until their PIN;
  // an attendee who backed out on their own phone is told to go back.
  if (query.desk && /^[0-9a-f-]{36}$/i.test(query.desk)) {
    if (auth.ok && (await isConferenceDeskStaff(auth.ctx, query.desk))) {
      redirect(`/admin/conference/${query.desk}/check-in`);
    }
    return (
      <main className="max-w-xl mx-auto py-16 px-4 text-center">
        <h1 className="text-2xl font-semibold text-gray-900">Payment not completed</h1>
        <p className="mt-3 text-base text-gray-700">Nothing was charged. Head back to the desk and they will help you.</p>
      </main>
    );
  }
  if (!auth.ok) redirect(loginWithNext(`/conference/${year}/${edition}/checkout/cancel`, query));

  const conferenceResult = await getPublicConference(parseInt(year, 10), edition);
  const conferenceName = conferenceResult.success && conferenceResult.data
    ? conferenceResult.data.name
    : "Conference";

  const orgParam = query.org ? `?org=${query.org}` : "";

  return (
    <main className="max-w-3xl mx-auto py-12 px-4 text-center">
      {conferenceResult.isDraftPreview && conferenceResult.data && (
        <div className="mb-4 text-left">
          <DraftPreviewBanner status={conferenceResult.data.status} />
        </div>
      )}

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
