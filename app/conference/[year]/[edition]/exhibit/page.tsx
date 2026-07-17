import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { getViewerContext } from "@/lib/visibility/viewer";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import ExhibitCheckoutForm from "./exhibit-checkout-form";

export const metadata = { title: "Exhibit at CSC" };

/**
 * Deliberately public — getViewerContext() falls back to an anonymous
 * viewer rather than requiring a session, so a brand-new prospect with no
 * account yet still reaches this page. Global admins get the same
 * draft-preview exception the rest of the site already gives
 * getPublicConference() (lib/actions/conference.ts), so this can be tested
 * before a conference goes public without exposing it to real members or
 * partners in the meantime.
 */
export default async function ExhibitPage({
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
    .select("id, name, year, edition_code, status")
    .eq("year", parseInt(year, 10))
    .eq("edition_code", edition)
    .maybeSingle();

  const isPublicStatus =
    !!conference && PUBLIC_CONFERENCE_STATUSES.includes(conference.status as (typeof PUBLIC_CONFERENCE_STATUSES)[number]);

  if (!conference || (!isPublicStatus && !canPreviewUnpublished)) {
    notFound();
  }
  const isDraftPreview = canPreviewUnpublished && !isPublicStatus;

  const { data: purchases } = await db
    .from("entity_purchases")
    .select("offer_entity_id")
    .eq("conference_id", conference.id);
  const claimedIds = new Set((purchases ?? []).map((p) => p.offer_entity_id).filter(Boolean));

  const { data: boothRows } = await db
    .from("conference_entities")
    .select("id, name, price_cents")
    .eq("conference_id", conference.id)
    .eq("kind", "booth")
    .eq("is_for_sale", true)
    .order("name");

  const availableBooths = (boothRows ?? [])
    .filter((b) => !claimedIds.has(b.id))
    .map((b) => ({ id: b.id, name: b.name, priceCents: b.price_cents ?? 0 }));

  return (
    <main className="max-w-2xl mx-auto px-4 py-12">
      {isDraftPreview && <div className="mb-6"><DraftPreviewBanner status={conference.status} /></div>}
      <h1 className="text-2xl font-semibold text-gray-900">Exhibit at {conference.name}</h1>
      <p className="mt-2 text-sm text-gray-600">
        New to Campus Stores Canada? Reserve your booth here — this also starts your
        membership. Payment doesn&apos;t mean you&apos;re approved yet: the board still
        reviews every new partnership application. You&apos;ll finish your application
        right after payment.
      </p>

      {availableBooths.length === 0 ? (
        <div className="mt-8 rounded-lg border border-gray-200 p-8 text-center text-gray-600">
          No booths are currently available for this conference.
        </div>
      ) : (
        <ExhibitCheckoutForm
          conferenceId={conference.id}
          conferenceYear={conference.year}
          conferenceEdition={conference.edition_code}
          booths={availableBooths}
        />
      )}
    </main>
  );
}
