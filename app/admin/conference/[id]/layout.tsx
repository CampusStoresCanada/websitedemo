import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { isCheckInDeskPath } from "@/lib/admin/nav";
import { REQUEST_PATHNAME_HEADER } from "@/lib/auth/request-path";
import { getConference } from "@/lib/actions/conference";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import ConferenceSubNav from "@/components/admin/conference/ConferenceSubNav";

export default async function ConferenceDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // ⛔ The check-in desk is a full-screen kiosk: no conference header or tabs.
  if (isCheckInDeskPath((await headers()).get(REQUEST_PATHNAME_HEADER) ?? "")) {
    return <>{children}</>;
  }
  const [result, auth] = await Promise.all([getConference(id), requireAuthenticated()]);

  if (!result.success || !result.data) {
    notFound();
  }

  const conference = result.data;

  return (
    <div>
      <ConferenceSubNav
        conferenceId={conference.id}
        conferenceName={conference.name}
        year={conference.year}
        editionCode={conference.edition_code}
        opsOnly={!auth.ok || !isGlobalAdmin(auth.ctx.globalRole)}
      />
      {children}
    </div>
  );
}
