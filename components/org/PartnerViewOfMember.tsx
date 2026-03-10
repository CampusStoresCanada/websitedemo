"use client";

import type { Organization } from "@/lib/database.types";
import type { VisibleOrganization, VisibleContact } from "@/lib/visibility/data";
import type { ProcurementInfo, ProductCategory } from "@/lib/types/procurement";
import { PRODUCT_CATEGORIES, hasProcurementInfo } from "@/lib/types/procurement";
import { ProtectedSection, BlurredValue } from "@/components/ui/GreyBlur";
import BlurredField from "@/components/ui/BlurredField";
import { useAuth } from "@/components/providers/AuthProvider";

interface PartnerViewOfMemberProps {
  organization: VisibleOrganization;
  contacts: VisibleContact[];
}

/**
 * Partner-specific view of member organization profiles.
 * Shows procurement-relevant information instead of benchmarking data.
 *
 * Visibility rules:
 * - Public: See product categories only (teaser)
 * - Partners: See full procurement details including requirements, buying cycle, buyer contact
 */
export default function PartnerViewOfMember({
  organization,
  contacts,
}: PartnerViewOfMemberProps) {
  const { permissionState } = useAuth();

  // Parse procurement_info from organization (stored as JSONB)
  const procurementInfo = (organization as Organization & { procurement_info?: ProcurementInfo }).procurement_info;

  const hasData = hasProcurementInfo(procurementInfo);
  const categories = procurementInfo?.product_categories || [];
  const requirements = procurementInfo?.requirements;
  const buyingCycle = procurementInfo?.buying_cycle;
  const buyerContactId = procurementInfo?.buyer_contact_id;

  // Find the buyer contact if specified
  const buyerContact = buyerContactId
    ? contacts.find(c => c.id === buyerContactId)
    : contacts.find(c => (c.role_title as string | null)?.toLowerCase().includes('buyer') || (c.role_title as string | null)?.toLowerCase().includes('procurement'));

  // If no procurement data at all, show a placeholder message
  if (!hasData) {
    return (
      <div className="bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto px-8 py-12">
          <h2 className="text-xl font-semibold text-[#1A1A1A] mb-4">
            Procurement Information
          </h2>
          <p className="text-gray-500">
            Procurement details for this organization are not yet available.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-8 py-12">
        <h2 className="text-xl font-semibold text-[#1A1A1A] mb-8">
          Procurement Information
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Left Column: Categories + Requirements */}
          <div className="space-y-10">
            {/* Product Categories — Always visible (teaser for public) */}
            {categories.length > 0 && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                  Product Categories
                </h3>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <span
                      key={category}
                      className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-full"
                    >
                      {category}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Procurement Requirements — Partners only */}
            {requirements && (
              <ProtectedSection
                requiredPermission="partner"
                bannerMessage="Partner members can view procurement requirements and vendor preferences."
                ctaText="Learn More"
                ctaLink="/partners"
              >
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                    Procurement Requirements
                  </h3>
                  <div className="space-y-4">
                    {/* Buy Local */}
                    {requirements.buy_local !== undefined && (
                      <div className="flex items-start gap-3">
                        <RequirementBadge active={requirements.buy_local} />
                        <div>
                          <span className="font-medium text-[#1A1A1A]">Buy Local Policy</span>
                          {requirements.buy_local_notes && (
                            <p className="text-sm text-gray-500 mt-0.5">
                              <BlurredValue placeholderWidth={30}>{requirements.buy_local_notes}</BlurredValue>
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Indigenous-Owned */}
                    {requirements.indigenous_owned !== undefined && (
                      <div className="flex items-start gap-3">
                        <RequirementBadge active={requirements.indigenous_owned} />
                        <div>
                          <span className="font-medium text-[#1A1A1A]">Indigenous-Owned Vendor Preference</span>
                          {requirements.indigenous_owned_notes && (
                            <p className="text-sm text-gray-500 mt-0.5">
                              <BlurredValue placeholderWidth={30}>{requirements.indigenous_owned_notes}</BlurredValue>
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Sustainability Certifications */}
                    {requirements.sustainability_certs && requirements.sustainability_certs.length > 0 && (
                      <div className="flex items-start gap-3">
                        <RequirementBadge active={true} />
                        <div>
                          <span className="font-medium text-[#1A1A1A]">Sustainability Certifications</span>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {requirements.sustainability_certs.map((cert) => (
                              <span
                                key={cert}
                                className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-full"
                              >
                                <BlurredValue placeholderWidth={10}>{cert}</BlurredValue>
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Other Requirements */}
                    {requirements.other_requirements && (
                      <div className="flex items-start gap-3">
                        <RequirementBadge active={true} />
                        <div>
                          <span className="font-medium text-[#1A1A1A]">Other Requirements</span>
                          <p className="text-sm text-gray-500 mt-0.5">
                            <BlurredValue placeholderWidth={40}>{requirements.other_requirements}</BlurredValue>
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </ProtectedSection>
            )}
          </div>

          {/* Right Column: Buying Cycle + Buyer Contact */}
          <div className="space-y-10">
            {/* Buying Cycle — Partners only */}
            {buyingCycle && (
              <ProtectedSection
                requiredPermission="partner"
                bannerMessage="Partner members can view RFP timelines and buying cycles."
                ctaText="Learn More"
                ctaLink="/partners"
              >
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                    Buying Cycle
                  </h3>
                  <div className="bg-gray-50 rounded-lg p-5 space-y-4">
                    {buyingCycle.fiscal_year_start && (
                      <div>
                        <span className="text-xs uppercase text-gray-400">Fiscal Year Starts</span>
                        <p className="font-medium text-[#1A1A1A]">
                          <BlurredValue placeholderWidth={12}>{buyingCycle.fiscal_year_start}</BlurredValue>
                        </p>
                      </div>
                    )}
                    {buyingCycle.rfp_window && (
                      <div>
                        <span className="text-xs uppercase text-gray-400">RFP Window</span>
                        <p className="font-medium text-[#1A1A1A]">
                          <BlurredValue placeholderWidth={18}>{buyingCycle.rfp_window}</BlurredValue>
                        </p>
                      </div>
                    )}
                    {buyingCycle.key_dates && (
                      <div>
                        <span className="text-xs uppercase text-gray-400">Key Dates</span>
                        <p className="text-sm text-gray-600">
                          <BlurredValue placeholderWidth={30}>{buyingCycle.key_dates}</BlurredValue>
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </ProtectedSection>
            )}

            {/* Buyer Contact — Partners only */}
            {buyerContact && (
              <ProtectedSection
                requiredPermission="partner"
                bannerMessage="Partner members can view buyer contact information."
                ctaText="Learn More"
                ctaLink="/partners"
              >
                <div>
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                    Buyer Contact
                  </h3>
                  <div className="bg-gray-50 rounded-lg p-5">
                    <div className="font-medium text-[#1A1A1A] text-lg">
                      {buyerContact.name ? (buyerContact.name as string) : <BlurredField placeholderWidth={15} />}
                    </div>
                    {buyerContact.role_title && (
                      <p className="text-gray-500 text-sm mt-0.5">
                        {buyerContact.role_title as string}
                      </p>
                    )}
                    <div className="mt-4 space-y-2 text-sm">
                      {(buyerContact.work_email || buyerContact.email) && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <EmailIcon />
                          {(() => {
                            const email = (buyerContact.work_email || buyerContact.email) as string;
                            if (email.startsWith("@") || email.includes("•")) return <BlurredField maskedValue={email} />;
                            return <a href={`mailto:${email}`} className="hover:text-[#1A1A1A] transition-colors">{email}</a>;
                          })()}
                        </div>
                      )}
                      {(buyerContact.work_phone_number || buyerContact.phone) && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <PhoneIcon />
                          {(() => {
                            const phone = (buyerContact.work_phone_number || buyerContact.phone) as string;
                            if (phone.includes("•")) return <BlurredField maskedValue={phone} />;
                            return <a href={`tel:${phone}`} className="hover:text-[#1A1A1A] transition-colors">{phone}</a>;
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </ProtectedSection>
            )}

            {/* No buyer contact but has other data */}
            {!buyerContact && hasData && (
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                  Buyer Contact
                </h3>
                <p className="text-gray-400 text-sm italic">
                  Buyer contact information not yet available.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Badge indicating if a requirement is active or not
 */
function RequirementBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="flex-shrink-0 w-5 h-5 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex-shrink-0 w-5 h-5 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </span>
  );
}

function EmailIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}
