import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { getViewerContext } from "@/lib/visibility/viewer";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import { getConfirmedExhibitors, getNonMemberDayPasses } from "@/lib/actions/conference-entities";
import { nonMemberDayPassToOffer } from "@/lib/conference/entity-commerce";
import { getRequiredLegalDocumentsPublic } from "@/lib/actions/conference-legal";
import { LEGAL_DOCUMENT_LABELS, type LegalDocumentType } from "@/lib/constants/conference";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import ConferenceHero from "@/components/conference/ConferenceHero";
import ScheduleAtAGlance from "@/components/conference/ScheduleAtAGlance";
import DayPassOfferCard from "@/components/conference/DayPassOfferCard";

export const metadata = { title: "Attend as a Non-Member" };

/**
 * Deliberately public — same pattern as /exhibit: getViewerContext() falls
 * back to an anonymous viewer, so someone with no CSC account can still buy a
 * Day Pass. This is the direct/bookmarkable URL for the exact same
 * registration surface the conference hub page already shows inline — the
 * hub page is the front door for everyone landing on the conference from
 * scratch; this route exists for a direct link (e.g. a marketing email)
 * without forcing a stop at the hub page first. Same DayPassOfferCard, same
 * data, so the two can never show a different answer to "what can I buy."
 */
export default async function AttendPage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const viewer = await getViewerContext();
  const canPreviewUnpublished =
    viewer.viewerLevel === "admin" ||
    viewer.viewerLevel === "super_admin" ||
    hasDraftPreviewAccess(viewer.viewerOrgIds);
  const db = createAdminClient();

  const { data: conference } = await db
    .from("conference_instances")
    .select("id, name, year, edition_code, status, start_date, end_date, location_venue, location_city, location_province")
    .eq("year", parseInt(year, 10))
    .eq("edition_code", edition)
    .maybeSingle();

  const isPublicStatus =
    !!conference && PUBLIC_CONFERENCE_STATUSES.includes(conference.status as (typeof PUBLIC_CONFERENCE_STATUSES)[number]);

  if (!conference || (!isPublicStatus && !canPreviewUnpublished)) {
    notFound();
  }
  const isDraftPreview = canPreviewUnpublished && !isPublicStatus;

  const venue = [conference.location_venue?.trim(), conference.location_city?.trim(), conference.location_province?.trim()]
    .filter(Boolean)
    .join(", ");

  const [dayPasses, exhibitors, legalResult] = await Promise.all([
    getNonMemberDayPasses(conference.id),
    getConfirmedExhibitors(conference.id),
    getRequiredLegalDocumentsPublic(conference.id, ["non_member"]),
  ]);
  const legalDocs = (legalResult.success ? legalResult.data ?? [] : []).map((d) => ({
    documentType: d.document_type,
    label: LEGAL_DOCUMENT_LABELS[d.document_type as LegalDocumentType] ?? d.document_type,
    content: d.content,
  }));

  return (
    <div>
      {isDraftPreview && (
        <div className="max-w-6xl mx-auto px-6 pt-6">
          <DraftPreviewBanner status={conference.status} />
        </div>
      )}

      <ConferenceHero
        name={conference.name}
        startDate={conference.start_date}
        endDate={conference.end_date}
        venue={venue}
        copy="Spend the day on the trade show floor — see what's new, talk directly with the vendors who supply campus stores across Canada, and every meal is on us. No membership, no account, no scheduled meetings required."
        sideContent={
          <>
            <p className="mb-3 text-sm font-medium uppercase tracking-wide text-white/60">
              Is your school eligible to join?
            </p>
            <p className="max-w-xs text-sm text-white/80 leading-relaxed">
              CSC membership is open to institutionally owned university, college, polytechnic,
              and CEGEP bookstores — and other campus retail operations — across Canada. Members
              get curated partner meetings, a share of the delegate travel bursary, and year-round
              community access.
            </p>
            <Link
              href="/membership"
              className="mt-4 inline-flex h-10 items-center rounded-full bg-white px-5 text-sm font-medium text-[#163D6D] transition-all hover:bg-white/90"
            >
              Apply for membership →
            </Link>
          </>
        }
      />

      <main className="max-w-2xl mx-auto px-4 py-12">
        {exhibitors.length > 0 ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Who you&apos;ll meet</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {exhibitors.map((ex) => (
                <span
                  key={ex.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700"
                >
                  {ex.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ex.logoUrl} alt="" className="h-4 w-4 rounded-full object-contain" />
                  ) : null}
                  {ex.name}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Exhibitor booths are still being confirmed — check back closer to the show to see who&apos;s on the floor.
          </p>
        )}

        {dayPasses.length === 0 ? (
          <div className="mt-8 rounded-lg border border-gray-200 p-8 text-center text-gray-600">
            No day passes are currently available for this conference.
          </div>
        ) : (
          <>
            <div className="mt-8">
              <DayPassOfferCard
                offers={dayPasses.map(nonMemberDayPassToOffer)}
                conferenceId={conference.id}
                conferenceYear={conference.year}
                conferenceEdition={conference.edition_code}
                legalDocs={legalDocs}
              />
            </div>
            <div className="mt-8">
              <ScheduleAtAGlance conferenceId={conference.id} conferenceStartDate={conference.start_date ?? ""} track="non_member" />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
