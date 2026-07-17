"use client";

import Link from "next/link";
import { formatCents } from "@/lib/utils";
import type { ConferenceOffer, ConferenceFloorPlan } from "@/lib/actions/conference-entities";
import FloorPlanViewer from "../floor-plan/floor-plan-viewer";
import OfferCard from "@/components/conference/OfferCard";
import DayPassOfferCard from "@/components/conference/DayPassOfferCard";

export default function OffersClient({
  conferenceId,
  conferenceYear,
  conferenceEdition,
  organizationId,
  organizationName,
  initialOffers,
  floorPlan = null,
  myCartOfferIds = new Set(),
  sponsorshipAnchorId,
}: {
  conferenceId: string;
  conferenceYear: string;
  conferenceEdition: string;
  organizationId: string;
  organizationName: string;
  initialOffers: ConferenceOffer[];
  floorPlan?: ConferenceFloorPlan | null;
  myCartOfferIds?: Set<string>;
  /** If set, the inline floor plan's legend links down to the tier comparison section with this id. */
  sponsorshipAnchorId?: string;
}) {
  if (initialOffers.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 p-8 text-center">
        <h2 className="text-lg font-semibold text-gray-900">Nothing on sale yet</h2>
        <p className="mt-2 text-sm text-gray-600">
          This conference has no offers available to {organizationName} right now.
        </p>
      </div>
    );
  }

  // Booths are spatial — selected on the floor plan.
  // Partners / admins see the map inline; everyone else gets a summary card with a link.
  const booths = initialOffers.filter((o) => o.kind === "booth");
  // The catalog models Tue/Wed/Thu Day Pass as separate entities (each needs
  // its own day's includes) — collapsed here into one "pick your day" card
  // rather than several near-identical offer cards. A non-member buyer's
  // eligible set is a subset of these same entities (e.g. "Thursday Day Pass
  // (Non-Member)" — a distinct entity from the member one because it can't
  // carry a Membership Renewal requirement) — matched by substring, not an
  // exact end-of-string suffix, so that variant still buckets in here too.
  const dayPasses = initialOffers.filter((o) => o.kind === "registration" && /Day Pass/i.test(o.name));
  const dayPassIds = new Set(dayPasses.map((o) => o.id));
  const otherOffers = initialOffers.filter((o) => o.kind !== "booth" && !dayPassIds.has(o.id));
  const boothsEligible = booths.some((b) => b.eligible);
  const boothsAvailable = booths.filter((b) => !b.soldOut && b.eligible).length;
  const boothIneligibleReason = booths.find((b) => !b.eligible)?.ineligibleReason ?? null;
  const boothPrices = booths.map((b) => b.unitPriceCents);
  const minBoothPrice = boothPrices.length ? Math.min(...boothPrices) : null;
  const maxBoothPrice = boothPrices.length ? Math.max(...boothPrices) : null;

  const showInlineMap = Boolean(floorPlan?.floorPlanUrl);

  return (
    <section className="space-y-4">
      {booths.length > 0 ? (
        showInlineMap ? (
          // Inline floor plan for partners / admins.
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Choose a Booth</h2>
                <p className="text-sm text-gray-500">
                  {boothsAvailable > 0
                    ? `${boothsAvailable} of ${booths.length} available · ${
                        minBoothPrice != null && maxBoothPrice != null
                          ? minBoothPrice === maxBoothPrice
                            ? formatCents(minBoothPrice)
                            : `from ${formatCents(minBoothPrice)}`
                          : ""
                      }`
                    : "All booths are currently sold or reserved"}
                </p>
              </div>
              <Link
                href={`/conference/${conferenceYear}/${conferenceEdition}/floor-plan?org=${organizationId}`}
                className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
              >
                Full screen →
              </Link>
            </div>
            <FloorPlanViewer
              conferenceId={conferenceId}
              conferenceYear={conferenceYear}
              conferenceEdition={conferenceEdition}
              organizationId={organizationId}
              floorPlanUrl={floorPlan!.floorPlanUrl!}
              booths={floorPlan!.booths}
              myCartOfferIds={myCartOfferIds}
              sponsorshipAnchorId={sponsorshipAnchorId}
            />
          </div>
        ) : (
          // Summary card + link for everyone else.
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Booth</div>
                <h3 className="text-base font-semibold text-gray-900">Exhibit at a Booth</h3>
                <p className="mt-1 text-sm text-gray-600">
                  {!boothsEligible
                    ? (boothIneligibleReason ?? "Not eligible to purchase a booth.")
                    : boothsAvailable > 0
                      ? `${boothsAvailable} of ${booths.length} booths available`
                      : "All booths are currently sold or reserved"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-lg font-semibold text-gray-900">
                  {minBoothPrice != null && maxBoothPrice != null
                    ? minBoothPrice === maxBoothPrice
                      ? formatCents(minBoothPrice)
                      : `From ${formatCents(minBoothPrice)}`
                    : null}
                </div>
              </div>
            </div>
            {boothsEligible ? (
              <div className="mt-4">
                <Link
                  href={`/conference/${conferenceYear}/${conferenceEdition}/floor-plan?org=${organizationId}`}
                  className="block w-full rounded-md bg-[#EE2A2E] px-4 py-2 text-center text-sm font-medium text-white hover:bg-[#b50001]"
                >
                  View the floor plan to choose your spot →
                </Link>
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {otherOffers.length > 0 || dayPasses.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {dayPasses.length > 0 ? (
            <DayPassOfferCard offers={dayPasses} conferenceId={conferenceId} organizationId={organizationId} />
          ) : null}
          {otherOffers.map((offer) => (
            <OfferCard key={offer.id} offer={offer} conferenceId={conferenceId} organizationId={organizationId} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
