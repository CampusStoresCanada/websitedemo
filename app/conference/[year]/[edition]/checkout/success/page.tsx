import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { createAdminClient } from "@/lib/supabase/admin";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";

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
        <p className="mt-2 text-sm text-gray-600">
          Your payment went through, but conference details could not be loaded.
        </p>
      </main>
    );
  }

  const conference = conferenceResult.data;

  // Look up the org slug so we can deep-link to the org's conference page.
  let orgConferenceHref: string | null = null;
  if (query.org) {
    const db = createAdminClient();
    const { data: org } = await db
      .from("organizations")
      .select("slug")
      .eq("id", query.org)
      .maybeSingle();
    if (org?.slug) {
      orgConferenceHref = `/org/${org.slug}`;
    }
  }

  const orgParam = query.org ? `?org=${query.org}` : "";

  return (
    <main className="max-w-3xl mx-auto py-12 px-4 text-center">
      {conferenceResult.isDraftPreview && (
        <div className="mb-4 text-left">
          <DraftPreviewBanner status={conference.status} />
        </div>
      )}

      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
        <svg className="h-7 w-7 text-green-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>

      <h1 className="text-2xl font-semibold text-gray-900">Checkout complete</h1>
      <p className="mt-2 text-sm text-gray-600">
        Payment for <strong>{conference.name}</strong> was submitted. It may take a few seconds
        for your order to finalise.
      </p>
      <p className="mt-1 text-sm text-gray-500">
        Once confirmed, any seats you didn&apos;t already assign are ready to assign to your team.
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {orgConferenceHref ? (
          <Link
            href={orgConferenceHref}
            className="rounded-md bg-[#EE2A2E] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#b50001]"
          >
            Go to your org profile to assign seats →
          </Link>
        ) : null}
        <Link
          href={`/conference/${year}/${edition}/orders${orgParam}`}
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-gray-400"
        >
          View orders
        </Link>
        <Link
          href={`/conference/${year}/${edition}${orgParam}`}
          className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-gray-400"
        >
          Back to conference
        </Link>
      </div>
    </main>
  );
}
