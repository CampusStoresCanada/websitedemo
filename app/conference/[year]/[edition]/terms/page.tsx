import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { LEGAL_DOCUMENT_LABELS, VISIBLE_CONFERENCE_STATUSES, type LegalDocumentType } from "@/lib/constants/conference";
import { getViewerContext } from "@/lib/visibility/viewer";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import { loadCurrentLegalVersions } from "@/lib/conference/legal-acceptance";
import { formatMemberFacingDate } from "@/lib/comms/format";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";

export const metadata = { title: "Terms & Conditions" };

/**
 * Every conference document in force, on one page anyone can open.
 *
 * Public on purpose, like the business case: an email links here (each
 * document has its own #document_type anchor), and the people deciding whether
 * to ask for support often have no CSC login. The documents are the ones the
 * agreement flows show; this page only displays them, it records nothing.
 */

// The documents a member is asked to agree to first, then the ones for vendors
// and speakers. Anything not listed goes last.
const ORDER: string[] = [
  "terms_and_conditions",
  "member_code_of_conduct",
  "privacy_notice",
  "refund_policy",
  "travel_bursary_terms",
  "cancoll_information_sharing",
  "code_of_conduct",
  "exhibitor_agreement",
  "speaker_agreement",
];

export default async function ConferenceTermsPage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const viewer = await getViewerContext();
  const isGlobalAdminViewer = viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";
  const canPreviewUnpublished = isGlobalAdminViewer || hasDraftPreviewAccess(viewer.viewerOrgIds);

  const db = createAdminClient();
  const { data: conference } = await db
    .from("conference_instances")
    .select("id, name, status")
    .eq("year", parseInt(year, 10))
    .eq("edition_code", edition)
    .maybeSingle();

  const isPublicStatus =
    !!conference && VISIBLE_CONFERENCE_STATUSES.includes(conference.status as (typeof VISIBLE_CONFERENCE_STATUSES)[number]);
  if (!conference || (!isPublicStatus && !canPreviewUnpublished)) {
    notFound();
  }
  const isDraftPreview = canPreviewUnpublished && !isPublicStatus;

  const { data: current } = await loadCurrentLegalVersions(db, conference.id);
  const rank = (type: string) => (ORDER.includes(type) ? ORDER.indexOf(type) : ORDER.length);
  const docs = [...current]
    .sort((a, b) => rank(a.document_type) - rank(b.document_type))
    .map((doc) => ({
      ...doc,
      label: LEGAL_DOCUMENT_LABELS[doc.document_type as LegalDocumentType] ?? doc.document_type,
    }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 print:py-0">
      {isDraftPreview && (
        <div className="mb-6 print:hidden">
          <DraftPreviewBanner status={conference.status} />
        </div>
      )}

      <h1 className="text-3xl font-bold tracking-tight text-[#1A1A1A]">{conference.name}: Terms &amp; Conditions</h1>
      <p className="mt-3 text-[#1A1A1A]/80">
        These are the documents in force for {conference.name}. You agree to the ones that apply to you when you
        register, request support, or take a seat someone named you to.
      </p>

      {docs.length > 0 && (
        <nav className="mt-6 print:hidden" aria-label="Documents">
          <ul className="space-y-1 text-sm">
            {docs.map((doc) => (
              <li key={doc.document_type}>
                <a href={`#${doc.document_type}`} className="font-medium text-[#163D6D] underline">
                  {doc.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {docs.length === 0 && <p className="mt-8 text-[#6B6B6B]">No documents have been published for this conference yet.</p>}

      {docs.map((doc) => (
        <section key={doc.document_type} id={doc.document_type} className="mt-10 scroll-mt-24">
          <h2 className="text-xl font-bold text-[#1A1A1A]">{doc.label}</h2>
          <p className="mt-1 text-xs text-[#6B6B6B]">
            Version {doc.version}, in effect from {formatMemberFacingDate(doc.effective_at.slice(0, 10))}
          </p>
          <div
            className="prose prose-sm mt-3 max-w-none text-[#1A1A1A]/90"
            dangerouslySetInnerHTML={{ __html: doc.content }}
          />
        </section>
      ))}
    </div>
  );
}
