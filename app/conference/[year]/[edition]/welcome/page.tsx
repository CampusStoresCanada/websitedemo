import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { getMyRequiredLegalDocuments, getMyLegalAcceptances } from "@/lib/actions/conference-legal";
import AssigneeAcceptance from "./AssigneeAcceptance";

export const metadata = { title: "Complete Your Registration" };

export default async function AssigneeWelcomePage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const confResult = await getPublicConference(parseInt(year, 10), edition);
  if (!confResult.success || !confResult.data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold text-gray-900">Conference not found</h1>
        <p className="mt-2 text-sm text-gray-600">This conference is not available.</p>
      </main>
    );
  }
  const conference = confResult.data;

  const docsResult = await getMyRequiredLegalDocuments(conference.id);
  const docs = docsResult.success ? docsResult.data ?? [] : [];
  const accResult = await getMyLegalAcceptances(conference.id);
  const acceptances = accResult.success ? accResult.data ?? [] : [];

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Welcome to {conference.name}</h1>
        <p className="mt-1 text-sm text-gray-600">
          You&rsquo;ve been registered for the conference. Review and accept the documents below to
          complete your registration and start participating.
        </p>
      </div>
      <AssigneeAcceptance
        docs={docs}
        acceptances={acceptances}
        hubHref={`/conference/${year}/${edition}`}
      />
    </main>
  );
}
