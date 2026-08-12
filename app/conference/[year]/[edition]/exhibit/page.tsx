import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { VISIBLE_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { getViewerContext } from "@/lib/visibility/viewer";
import { hasDraftPreviewAccess } from "@/lib/conference/draft-preview";
import { getFloorPlanForVisitor } from "@/lib/actions/conference-entities";
import DraftPreviewBanner from "@/components/conference/DraftPreviewBanner";
import ExhibitCheckoutForm from "./exhibit-checkout-form";
import FloorPlanViewer from "../floor-plan/floor-plan-viewer";

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
    !!conference && VISIBLE_CONFERENCE_STATUSES.includes(conference.status as (typeof VISIBLE_CONFERENCE_STATUSES)[number]);

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

  // Always loaded (not just when nothing's for sale) — the interactive map
  // is the primary way to pick a specific booth once sales are live, not
  // just a pre-sale preview. Previously this only fetched when
  // availableBooths was empty, so the moment real sales opened, visitors
  // got dropped from the map into a plain name-ordered dropdown
  // (ExhibitCheckoutForm) — exactly backwards, since that's the moment the
  // map matters most. Same fix as the conference hub's exhibitor path.
  const floorResult = await getFloorPlanForVisitor(conference.id);
  const floorPlan: { floorPlanUrl: string | null; booths: import("@/lib/actions/conference-entities").FloorPlanBooth[] } | null =
    floorResult.success ? floorResult.data : null;

  const showFloorPlanFallback = Boolean(floorPlan?.floorPlanUrl) && (floorPlan?.booths.length ?? 0) > 0;

  return (
    <main className={`mx-auto px-4 py-12 ${showFloorPlanFallback ? "max-w-4xl" : "max-w-2xl"}`}>
      {isDraftPreview && <div className="mb-6"><DraftPreviewBanner status={conference.status} /></div>}
      <h1 className="text-2xl font-semibold text-gray-900">Exhibit at {conference.name}</h1>
      <p className="mt-2 text-sm text-gray-600">
        New to Campus Stores Canada? Reserve your booth here — this also starts your
        membership. Payment doesn&apos;t mean you&apos;re approved yet: the board still
        reviews every new partnership application. You&apos;ll finish your application
        right after payment.
      </p>

      <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">Already exhibited with us before?</p>
        <p className="mt-1 text-sm text-blue-800">
          Sign in to buy through your existing account — anything purchased below creates a new prospect record
          instead of attaching to it.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/conference/${year}/${edition}`)}`}
          className="mt-2 inline-block text-sm font-medium text-blue-900 underline hover:no-underline"
        >
          Sign in instead →
        </Link>
      </div>

      {showFloorPlanFallback ? (
        <div className="mt-8 space-y-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Choose a Booth</h2>
            <p className="text-sm text-gray-500">
              {floorPlan!.booths.filter((b) => b.status === "available").length > 0
                ? `${floorPlan!.booths.filter((b) => b.status === "available").length} of ${floorPlan!.booths.length} available`
                : "Booth sales haven't opened yet — take a look around"}
            </p>
          </div>
          <FloorPlanViewer
            conferenceId={conference.id}
            conferenceYear={year}
            conferenceEdition={edition}
            organizationId={null}
            floorPlanUrl={floorPlan!.floorPlanUrl!}
            booths={floorPlan!.booths}
          />
        </div>
      ) : availableBooths.length > 0 ? (
        <ExhibitCheckoutForm
          conferenceId={conference.id}
          conferenceYear={conference.year}
          conferenceEdition={conference.edition_code}
          booths={availableBooths}
        />
      ) : (
        <div className="mt-8 rounded-lg border border-gray-200 p-8 text-center text-gray-600">
          No booths are currently available for this conference.
        </div>
      )}
    </main>
  );
}
