"use client";

import type { Organization } from "@/lib/types/db";
import type { VisibleOrganization, VisibleContact } from "@/lib/visibility/data";
import type { ProcurementInfo, KeyDate } from "@/lib/types/procurement";
import {
  hasProcurementInfo,
  hasBuyingCycleContent,
  normalizeKeyDates,
  buyingCycleNotes,
} from "@/lib/types/procurement";
import { ProtectedSection, BlurredValue } from "@/components/ui/GreyBlur";
import BlurredField from "@/components/ui/BlurredField";

interface PartnerViewOfMemberProps {
  organization: VisibleOrganization;
  contacts: VisibleContact[];
}

/**
 * Partner-facing view of a member org's procurement information.
 *
 * Visibility:
 *  - Public: category list only (teaser)
 *  - Partners: full detail — buyers, vendor preferences, sourcing, buying cycle
 */
export default function PartnerViewOfMember({
  organization,
  contacts,
}: PartnerViewOfMemberProps) {
  const procurementInfo = (organization as Organization & { procurement_info?: ProcurementInfo })
    .procurement_info;

  const hasData = hasProcurementInfo(procurementInfo);
  const categoryBuyers = procurementInfo?.category_buyers ?? [];
  const preferredCerts = procurementInfo?.preferred_certifications ?? [];
  const requirementsNotes = procurementInfo?.requirements_notes?.trim() ?? "";
  const sourcingProvinces = procurementInfo?.sourcing_provinces ?? [];
  const buyingCycle = procurementInfo?.buying_cycle;
  const keyDates = normalizeKeyDates(buyingCycle?.key_dates);
  const cycleNotes = buyingCycleNotes(buyingCycle);

  const storeServices = procurementInfo?.store_services ?? [];
  const contactById = Object.fromEntries(contacts.map((c) => [c.id, c]));

  // Visibility flags — default true when absent
  const vis = {
    categories:     procurementInfo?.show_categories     ?? true,
    storeServices:  procurementInfo?.show_store_services ?? true,
    certifications: procurementInfo?.show_certifications ?? true,
    provinces:      procurementInfo?.show_provinces      ?? true,
    buyingCycle:    procurementInfo?.show_buying_cycle   ?? true,
  };

  if (!hasData) {
    return (
      <div className="bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-8 py-12">
          <h2 className="text-xl font-semibold text-[#1A1A1A] mb-4">Procurement Information</h2>
          <p className="text-gray-500">Procurement details for this organization are not yet available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-8 py-12">
        <h2 className="text-xl font-semibold text-[#1A1A1A] mb-8">Procurement Information</h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">

          {/* ── Left: categories + buyers + store services ── */}
          <div className="space-y-10">
            {categoryBuyers.length > 0 && vis.categories && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                  What They Carry & Who Buys It
                </h3>

                {/* Category list always visible (teaser) */}
                <div className="space-y-2 mb-4">
                  {categoryBuyers.map((entry) => {
                    const subcategories = entry.contact_subcategories
                      ? Array.from(new Set(Object.values(entry.contact_subcategories).flat()))
                      : [];
                    return (
                      <div key={entry.category}>
                        <span className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-full inline-block">
                          {entry.category}
                        </span>
                        {subcategories.length > 0 && (
                          <div className="ml-3 mt-1.5 flex flex-wrap gap-1.5">
                            {subcategories.map((sub) => (
                              <span key={sub} className="px-2 py-0.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-500">
                                {sub}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Buyer detail — partners only; contacts hidden in Staffing are excluded */}
                <ProtectedSection
                  requiredPermission="partner"
                  bannerMessage="Partner members can view buyer contacts for each product category."
                  ctaText="Learn More"
                  ctaLink="/partners"
                >
                  <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden">
                    {categoryBuyers.map((entry) => {
                      const buyers = entry.contact_ids
                        .map((id) => contactById[id])
                        .filter((b): b is VisibleContact => Boolean(b) && !(b?.hidden ?? false));
                      return (
                        <div key={entry.category} className="flex items-start gap-4 px-4 py-3 bg-white">
                          <span className="min-w-[160px] font-medium text-[#1A1A1A] text-sm">
                            {entry.category}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {buyers.length > 0 ? (
                              buyers.map((b) => (
                                <span
                                  key={b.id}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-full text-xs text-gray-700"
                                >
                                  {b.name ? (
                                    isMasked(b.name as string) ? (
                                      <BlurredField maskedValue={b.name as string} />
                                    ) : (
                                      (b.name as string)
                                    )
                                  ) : "—"}
                                  {b.role_title && (
                                    <span className="text-gray-400">
                                      · <BlurredValue placeholderWidth={8}>{b.role_title as string}</BlurredValue>
                                    </span>
                                  )}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-gray-400 italic">No buyer assigned</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ProtectedSection>
              </div>
            )}

            {/* Store services */}
            {storeServices.length > 0 && vis.storeServices && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                  Store Services
                </h3>
                <div className="flex flex-wrap gap-2">
                  {storeServices.map((svc) => (
                    <span key={svc} className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full">
                      {svc}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Right: preferences + buying cycle ── */}
          <div className="space-y-10">

            {/* Vendor certification preferences — partners only */}
            {(preferredCerts.length > 0 || requirementsNotes) && vis.certifications && (
              <ProtectedSection
                requiredPermission="partner"
                bannerMessage="Partner members can view vendor certification preferences."
                ctaText="Learn More"
                ctaLink="/partners"
              >
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                    Vendor Preferences
                  </h3>
                  {preferredCerts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {preferredCerts.map((cert) => (
                        <span
                          key={cert}
                          className="px-3 py-1 bg-green-50 text-green-700 text-sm rounded-full border border-green-100"
                        >
                          <BlurredValue placeholderWidth={10}>{cert}</BlurredValue>
                        </span>
                      ))}
                    </div>
                  )}
                  {requirementsNotes && (
                    <p className="mt-3 text-sm">
                      <BlurredValue placeholderWidth={28}>{requirementsNotes}</BlurredValue>
                    </p>
                  )}
                </div>
              </ProtectedSection>
            )}

            {/* Sourcing provinces — partners only */}
            {sourcingProvinces.length > 0 && vis.provinces && (
              <ProtectedSection
                requiredPermission="partner"
                bannerMessage="Partner members can view sourcing preferences."
                ctaText="Learn More"
                ctaLink="/partners"
              >
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                    Sourcing Preferences
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {sourcingProvinces.map((prov) => (
                      <span
                        key={prov}
                        className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full border border-blue-100"
                      >
                        <BlurredValue placeholderWidth={8}>{prov}</BlurredValue>
                      </span>
                    ))}
                  </div>
                </div>
              </ProtectedSection>
            )}

            {/* Buying cycle — partners only */}
            {vis.buyingCycle && buyingCycle && hasBuyingCycleContent(buyingCycle) && (
                <ProtectedSection
                  requiredPermission="partner"
                  bannerMessage="Partner members can view RFP timelines and buying cycles."
                  ctaText="Learn More"
                  ctaLink="/partners"
                >
                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                      Buying Cycle
                    </h3>
                    <div className="bg-gray-50 rounded-xl p-5 space-y-3">
                      {buyingCycle.fiscal_year_start && (
                        <div>
                          <span className="text-xs uppercase text-gray-400">Fiscal Year Starts</span>
                          <p className="font-medium text-[#1A1A1A]">
                            <BlurredValue placeholderWidth={10}>{buyingCycle.fiscal_year_start}</BlurredValue>
                          </p>
                        </div>
                      )}
                      {buyingCycle.rfp_window && (
                        <div>
                          <span className="text-xs uppercase text-gray-400">RFP Window</span>
                          <p className="font-medium text-[#1A1A1A]">
                            <BlurredValue placeholderWidth={12}>{buyingCycle.rfp_window}</BlurredValue>
                          </p>
                        </div>
                      )}
                      {keyDates.length > 0 && (
                        <div>
                          <span className="text-xs uppercase text-gray-400">Key Dates</span>
                          <div className="mt-1 space-y-1">
                            {keyDates.map((kd: KeyDate, i: number) => (
                              <div key={i} className="flex items-center gap-3 text-sm">
                                <BlurredValue placeholderWidth={12}>{kd.title}</BlurredValue>
                                <span className="text-gray-400">·</span>
                                <BlurredValue placeholderWidth={10}>{formatDate(kd.date)}</BlurredValue>
                                {kd.recurring && (
                                  <span className="text-xs text-gray-400 italic">annually</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {cycleNotes && (
                        <div>
                          <span className="text-xs uppercase text-gray-400">Notes</span>
                          <p className="text-sm">
                            <BlurredValue placeholderWidth={24}>{cycleNotes}</BlurredValue>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </ProtectedSection>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

function isMasked(value: string) {
  return value.startsWith("@") || value.includes("•");
}
