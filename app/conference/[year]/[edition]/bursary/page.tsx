import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { getBursaryClaimWindow, getBursaryRequest, getBursarySchool } from "@/lib/actions/conference-bursary";
import { loginWithNext } from "@/lib/auth/login-redirect";
import BursaryRequestForm from "./BursaryRequestForm";

export const metadata = { title: "Travel Support Request" };

/**
 * A member school's travel bursary request. One per school; anyone registered
 * from the school, or its admin, can fill it in.
 *
 * The expense claim is a separate step after the conference, on its own page
 * (./claim); this page only points at it once the request is in.
 */
export default async function BursaryRequestPage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect(loginWithNext(`/conference/${year}/${edition}/bursary`));

  const confResult = await getPublicConference(parseInt(year, 10), edition);
  if (!confResult.success || !confResult.data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold text-gray-900">Conference not found</h1>
      </main>
    );
  }
  const conference = confResult.data;

  const school = await getBursarySchool();
  if (!school) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold text-gray-900">Travel support</h1>
        <p className="mt-2 text-sm text-gray-600">Travel support is for CSC member institutions.</p>
        <p className="mt-2 text-sm">
          <a href={`/conference/${year}/${edition}/terms#travel_bursary_terms`} className="text-[#163D6D] underline">
            Read the Travel Bursary Terms
          </a>
        </p>
      </main>
    );
  }

  const request = await getBursaryRequest({ conferenceId: conference.id, organizationId: school.id });
  const claimWindow =
    request.success && request.data.submittedAt ? await getBursaryClaimWindow(conference.id) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm text-gray-500">{conference.name}</p>
      <h1 className="text-2xl font-semibold text-gray-900">Travel support for {school.name}</h1>
      <p className="mt-1 text-sm">
        <a href={`/conference/${year}/${edition}/terms#travel_bursary_terms`} className="text-[#163D6D] underline">
          Read the full Travel Bursary Terms
        </a>
      </p>
      {request.success ? (
        <BursaryRequestForm
          conferenceId={conference.id}
          organizationId={school.id}
          view={request.data}
          registerHref={`/conference/${year}/${edition}/register`}
        />
      ) : (
        <p className="mt-4 text-sm text-gray-600">{request.error}</p>
      )}
      {claimWindow && (
        <p className="mt-8 text-sm text-gray-800">
          {claimWindow.notYetOpen ? (
            <>After the conference, you&apos;ll file your expense claim on its own page. Claims open {claimWindow.opensOnLabel}.</>
          ) : (
            <a href={`/conference/${year}/${edition}/bursary/claim`} className="font-medium text-[#163D6D] underline">
              {claimWindow.open ? "File your expense claim" : "See your expense claim"}
            </a>
          )}
        </p>
      )}
    </main>
  );
}
