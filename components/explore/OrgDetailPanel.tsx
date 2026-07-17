"use client";

import { useState } from "react";
import Link from "next/link";
import type { HomeMapOrg } from "@/lib/homepage";
import type { ExploreLens } from "@/lib/explore/types";
import type { CompoundFilters } from "@/lib/explore/types";
import { CertificationBadges } from "@/components/ui/CertificationBadges";
import type { ProcurementPanelData, MemberOrgProfile } from "@/lib/actions/partner-context";
import OrgLogo from "@/components/ui/OrgLogo";

type ContactEntry = {
  name: string;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
};

interface OrgDetailPanelProps {
  org: HomeMapOrg;
  isMember: boolean;
  /** True if viewer can see CANCOLL status (members + CANCOLL partners) */
  canViewCancoll?: boolean;
  contacts?: ContactEntry[];
  onClose?: () => void;
  /** When provided, values become clickable to filter by that attribute */
  onFilterByValue?: (lens: ExploreLens, filters: CompoundFilters) => void;
  /** Set when a logged-in partner is viewing a member org — triggers partner-specific panel */
  partnerCategory?: string | null;
  procurementPanel?: ProcurementPanelData | null;
  procurementPanelLoading?: boolean;
  /** Set when a logged-in member is viewing a partner org — triggers member-specific panel */
  memberProfile?: MemberOrgProfile | null;
}

/** Org detail panel — rich card with organized sections + membership gating */
export function OrgDetailPanel({ org, isMember, canViewCancoll = false, contacts = [], onClose, onFilterByValue, partnerCategory, procurementPanel, procurementPanelLoading = false, memberProfile }: OrgDetailPanelProps) {
  // Partner viewing a member org — show a personalised procurement briefing
  const showPartnerView = !!partnerCategory && org.type === "Member";
  // Member viewing a partner org — show a fit-aware partner briefing
  const showMemberPartnerView = !!memberProfile && org.type === "Vendor Partner";
  const hasOperationalData = !!(
    org.posSystem ||
    org.operationsMandate ||
    (org.servicesOffered && org.servicesOffered.length > 0) ||
    (org.paymentOptions && org.paymentOptions.length > 0) ||
    (org.shoppingServices && org.shoppingServices.length > 0)
  );

  const hasTechData = !!(
    org.lmsSystem ||
    (org.socialMediaPlatforms && org.socialMediaPlatforms.length > 0)
  );

  const hasQuickFacts = !!(
    org.enrollmentFte || org.numLocations || org.totalSquareFootage || org.fulltimeEmployees
  );

  return (
    <div className="p-5 space-y-4" data-org-id={org.id}>
      {/* Header */}
      <div className="flex items-start gap-3">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mt-1 w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <Link href={`/org/${org.slug}`} className="flex items-start gap-3 flex-1 min-w-0 group">
          <OrgLogo
            name={org.name}
            logoUrl={org.logoUrl}
            className="w-14 h-14 rounded-xl border border-gray-200 flex-shrink-0"
          />
          <div className="min-w-0 pt-0.5">
            <h3 className="text-base font-semibold text-gray-900 leading-tight group-hover:text-[#EE2A2E] transition-colors">
              {org.name}
            </h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {org.city && <span>{org.city}</span>}
            {org.city && org.province && ", "}
            {org.province && onFilterByValue ? (
              <button
                type="button"
                onClick={() => onFilterByValue(null, { province: org.province! })}
                className="text-gray-500 hover:text-[#EE2A2E] hover:underline transition-colors"
                title={`Show all in ${org.province}`}
              >
                {org.province}
              </button>
            ) : org.province ? (
              <span>{org.province}</span>
            ) : null}
          </p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                org.type === "Member"
                  ? "bg-red-50 text-red-700 border border-red-100"
                  : "bg-blue-50 text-[#D92327] border border-blue-100"
              }`}
            >
              {org.type === "Vendor Partner" ? "Partner" : org.type}
            </span>
            {org.organizationType && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                {org.organizationType}
              </span>
            )}
            {org.primaryCategory && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">
                {org.primaryCategory}
              </span>
            )}
          </div>
          </div>
        </Link>
      </div>

      {/* ── Partner viewing a member: personalised procurement briefing ── */}
      {showPartnerView && (
        <>
          {procurementPanelLoading ? (
            /* Loading skeleton */
            <div className="space-y-3 animate-pulse">
              <div className="h-3 w-1/3 rounded bg-gray-200" />
              <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                <div className="flex gap-3 items-center">
                  <div className="w-9 h-9 rounded-full bg-gray-200 flex-shrink-0" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-3 w-2/3 rounded bg-gray-200" />
                    <div className="h-2.5 w-1/2 rounded bg-gray-200" />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">

              {/* ── Your contact for [category] ── */}
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Your contact for {partnerCategory}
                </p>
                {procurementPanel?.categoryBuyer === null ? (
                  /* Partner's category not in their carry list */
                  <div className="rounded-xl border border-dashed border-gray-200 px-3 py-3 text-center">
                    <p className="text-xs text-gray-500">
                      {org.name} doesn&apos;t list {partnerCategory} as a carried category.
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">The primary contact may still be a starting point.</p>
                  </div>
                ) : procurementPanel?.categoryBuyer?.contact ? (
                  /* Category buyer found */
                  <ContactCard contact={procurementPanel.categoryBuyer.contact} highlight />
                ) : procurementPanel?.categoryBuyer && !procurementPanel.categoryBuyer.contact ? (
                  /* Category is carried but no buyer assigned */
                  <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/50 px-3 py-3 text-center">
                    <p className="text-xs text-amber-700 font-medium">No buyer assigned for {partnerCategory} yet.</p>
                    <p className="text-[11px] text-amber-600/70 mt-0.5">Start with the primary contact below.</p>
                  </div>
                ) : null}
              </div>

              {/* ── Primary contact as backup ── */}
              {contacts.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    {procurementPanel?.categoryBuyer?.contact ? "Primary contact" : "Primary contact"}
                  </p>
                  <ContactCard contact={contacts[0]} />
                </div>
              )}

              {/* ── Quick facts ── */}
              {(org.enrollmentFte != null || org.numLocations != null || org.totalSquareFootage != null || org.fulltimeEmployees != null) && (
                <div className="grid grid-cols-2 gap-2">
                  {org.enrollmentFte != null && (
                    <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">Enrollment</p>
                      <p className="text-sm font-bold text-gray-900">{org.enrollmentFte.toLocaleString()} FTE</p>
                    </div>
                  )}
                  {org.numLocations != null && (
                    <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">Locations</p>
                      <p className="text-sm font-bold text-gray-900">{org.numLocations}</p>
                    </div>
                  )}
                  {org.fulltimeEmployees != null && (
                    <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">Staff</p>
                      <p className="text-sm font-bold text-gray-900">{org.fulltimeEmployees}</p>
                    </div>
                  )}
                  {org.totalSquareFootage != null && (
                    <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">Sq Ft</p>
                      <p className="text-sm font-bold text-gray-900">{org.totalSquareFootage.toLocaleString()}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Vendor preferences ── */}
              {procurementPanel && procurementPanel.preferredCertifications.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Vendor preferences</p>
                  <CertificationBadges certifications={procurementPanel.preferredCertifications} size="sm" />
                </div>
              )}

              {/* ── Buying window ── */}
              {procurementPanel?.buyingWindow && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Buying window</p>
                  <BuyingWindowChip window={procurementPanel.buyingWindow} />
                </div>
              )}

            </div>
          )}

          {/* ── Actions ── */}
          <div className="space-y-2 pt-1">
            <Link
              href={`/org/${org.slug}`}
              className="w-full inline-flex items-center justify-center rounded-xl bg-[#EE2A2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#D92327] transition-colors"
            >
              Full procurement profile →
            </Link>
            {org.website && (
              <a
                href={org.website}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Visit Website ↗
              </a>
            )}
          </div>
        </>
      )}

      {/* ── Member viewing a partner: fit-aware briefing ── */}
      {showMemberPartnerView && (() => {
        const categoryMatch = !!org.primaryCategory && memberProfile!.categories.includes(org.primaryCategory);
        const matchedCerts = org.certifications.filter(c => memberProfile!.preferredCertifications.includes(c));
        const hasFit = categoryMatch || matchedCerts.length > 0;
        const contact = contacts[0] ?? null;

        return (
          <>
            {/* Fit signal */}
            <div className={`rounded-xl border p-3.5 space-y-2.5 ${hasFit ? "border-green-200 bg-green-50/40" : "border-gray-200 bg-gray-50/40"}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {hasFit ? "Potential Match" : "No direct match"}
              </p>

              {/* Category */}
              {org.primaryCategory ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Category</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                    categoryMatch
                      ? "bg-green-50 text-green-700 border-green-300 ring-2 ring-green-400 ring-offset-1"
                      : "bg-gray-50 text-gray-600 border-gray-200"
                  }`}>
                    {categoryMatch && (
                      <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {org.primaryCategory}
                  </span>
                  {!categoryMatch && memberProfile!.categories.length > 0 && (
                    <span className="text-[10px] text-gray-400">not in your categories</span>
                  )}
                  {!categoryMatch && memberProfile!.categories.length === 0 && (
                    <span className="text-[10px] text-gray-400">set up your profile to see fit</span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400">No category declared</p>
              )}

              {/* Certifications */}
              {org.certifications.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-xs text-gray-500 mt-0.5">Certs</span>
                  <CertificationBadges
                    certifications={org.certifications}
                    highlightSet={new Set(memberProfile!.preferredCertifications)}
                    size="sm"
                  />
                </div>
              )}

              {matchedCerts.length > 0 && (
                <p className="text-[10px] text-green-700 font-medium">
                  ✓ Holds {matchedCerts.length === 1 ? "a certification" : `${matchedCerts.length} certifications`} you prefer
                </p>
              )}
            </div>

            {/* About */}
            {(org.companyDescription || org.highlightProductName) && (
              <div className="space-y-1.5">
                {org.highlightProductName && (
                  <p className="text-xs font-semibold text-gray-800">{org.highlightProductName}</p>
                )}
                {org.companyDescription && (
                  <p className="text-xs text-gray-500 leading-relaxed">{org.companyDescription}</p>
                )}
              </div>
            )}

            {/* Primary contact */}
            {contact && (
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Contact</p>
                <ContactCard contact={contact} />
              </div>
            )}

            {/* Actions */}
            <div className="space-y-2">
              {org.catalogueUrl && (
                <a
                  href={org.catalogueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#EE2A2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#D92327] transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                  View Catalogue
                </a>
              )}
              {org.website && (
                <a
                  href={org.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Visit Website ↗
                </a>
              )}
              <Link
                href={`/org/${org.slug}`}
                className="w-full inline-flex items-center justify-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Full Profile →
              </Link>
            </div>
          </>
        );
      })()}

      {/* ── Standard view (member or public) ── */}
      {!showPartnerView && !showMemberPartnerView && <>

      {/* Partner spotlight — description + highlight product */}
      {org.type === "Vendor Partner" && (org.companyDescription || org.highlightProductName) && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3.5 space-y-2.5">
          {org.companyDescription && (
            <p className="text-xs text-gray-600 leading-relaxed">
              {org.companyDescription}
            </p>
          )}
          {org.highlightProductName && (
            <div className="border-t border-blue-100 pt-2.5">
              <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider mb-1">Tagline</p>
              <p className="text-xs font-medium text-gray-800">{org.highlightProductName}</p>
            </div>
          )}
        </div>
      )}

      {/* Certifications — partners show all badges; members show CANCOLL only */}
      {org.type === "Vendor Partner"
        ? (org.certifications?.length > 0 || (canViewCancoll && org.isCancollMember)) && (
            <CertificationBadges
              certifications={org.certifications ?? []}
              size="sm"
              showCancoll={canViewCancoll && org.isCancollMember}
            />
          )
        : canViewCancoll && org.isCancollMember && (
            <CertificationBadges
              certifications={[]}
              size="sm"
              showCancoll={true}
            />
          )
      }

      {/* Primary Contacts — member-gated */}
      {contacts.length > 0 && (
        <div className="relative">
          {!isMember && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl">
              <div className="text-center px-3 py-2 rounded-lg bg-white/95 shadow-sm border border-gray-200">
                <svg className="w-4 h-4 text-gray-400 mx-auto mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <p className="text-[11px] font-medium text-gray-600">Members only</p>
              </div>
            </div>
          )}
          <div className={!isMember ? "blur-[6px] opacity-50 pointer-events-none select-none" : ""}>
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                  {contacts.length === 1 ? "Primary Contact" : "Primary Contacts"}
                </p>
              </div>
              {contacts.map((contact, i) => (
                <div key={contact.email ?? contact.name} className={`p-3 flex items-start gap-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
                  {contact.avatarUrl ? (
                    <img src={contact.avatarUrl} alt={contact.name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-slate-500 font-medium text-xs">
                        {contact.name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{contact.name}</p>
                    {contact.roleTitle && (
                      <p className="text-xs text-gray-500 truncate">{contact.roleTitle}</p>
                    )}
                    {contact.email && (
                      <a href={`mailto:${contact.email}`} className="text-xs text-[#EE2A2E] hover:underline truncate block mt-0.5">
                        {contact.email}
                      </a>
                    )}
                    {contact.phone && (
                      <a href={`tel:${contact.phone}`} className="text-xs text-gray-500 hover:text-[#EE2A2E] transition-colors truncate block">
                        {contact.phone}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Quick Facts Strip — visible to all */}
      {hasQuickFacts && (
        <div className="grid grid-cols-2 gap-2">
          {org.enrollmentFte != null && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Enrollment</p>
              <p className="text-sm font-bold text-gray-900">{org.enrollmentFte.toLocaleString()} FTE</p>
            </div>
          )}
          {org.numLocations != null && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Locations</p>
              <p className="text-sm font-bold text-gray-900">{org.numLocations}</p>
            </div>
          )}
          {org.totalSquareFootage != null && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Sq Ft</p>
              <p className="text-sm font-bold text-gray-900">{org.totalSquareFootage.toLocaleString()}</p>
            </div>
          )}
          {org.fulltimeEmployees != null && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Staff</p>
              <p className="text-sm font-bold text-gray-900">{org.fulltimeEmployees}</p>
            </div>
          )}
        </div>
      )}

      {/* Operations Section — members only */}
      {hasOperationalData && (
        <div className="relative">
          {!isMember && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl">
              <div className="text-center px-4 py-2.5 rounded-lg bg-white/95 shadow-sm border border-gray-200">
                <svg className="w-4 h-4 text-gray-400 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <p className="text-[11px] font-medium text-gray-600">Members only</p>
              </div>
            </div>
          )}
          <div className={!isMember ? "blur-[6px] opacity-50 pointer-events-none select-none" : ""}>
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Operations</p>
              </div>
              <div className="p-3 space-y-2.5">
                {org.posSystem && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] text-gray-500 w-16 flex-shrink-0 uppercase tracking-wider">POS</span>
                    {onFilterByValue ? (
                      <button
                        type="button"
                        onClick={() => onFilterByValue(null, { pos: org.posSystem! })}
                        className="text-sm font-medium text-gray-900 hover:text-[#EE2A2E] hover:underline transition-colors"
                        title={`Show all using ${org.posSystem}`}
                      >
                        {org.posSystem}
                      </button>
                    ) : (
                      <span className="text-sm font-medium text-gray-900">{org.posSystem}</span>
                    )}
                  </div>
                )}
                {org.operationsMandate && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] text-gray-500 w-16 flex-shrink-0 uppercase tracking-wider">Model</span>
                    {onFilterByValue ? (
                      <button
                        type="button"
                        onClick={() => onFilterByValue(null, { mandate: org.operationsMandate! })}
                        className="text-sm font-medium text-gray-900 hover:text-[#EE2A2E] hover:underline transition-colors"
                        title={`Show all ${org.operationsMandate}`}
                      >
                        {org.operationsMandate}
                      </button>
                    ) : (
                      <span className="text-sm font-medium text-gray-900">{org.operationsMandate}</span>
                    )}
                  </div>
                )}
                {org.servicesOffered && org.servicesOffered.length > 0 && (
                  <div>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">Services</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {org.servicesOffered.map((s) =>
                        onFilterByValue ? (
                          <button
                            key={s}
                            type="button"
                            onClick={() => onFilterByValue(null, { service: s })}
                            className="rounded-md bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 cursor-pointer hover:ring-2 hover:ring-emerald-300 transition-all"
                            title={`Show all offering ${s}`}
                          >
                            {s}
                          </button>
                        ) : (
                          <span key={s} className="rounded-md bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">{s}</span>
                        )
                      )}
                    </div>
                  </div>
                )}
                {org.paymentOptions && org.paymentOptions.length > 0 && (
                  <div>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">Payment</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {org.paymentOptions.map((p) =>
                        onFilterByValue ? (
                          <button
                            key={p}
                            type="button"
                            onClick={() => onFilterByValue(null, { payment: p })}
                            className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 cursor-pointer hover:ring-2 hover:ring-gray-300 transition-all"
                            title={`Show all accepting ${p}`}
                          >
                            {p}
                          </button>
                        ) : (
                          <span key={p} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{p}</span>
                        )
                      )}
                    </div>
                  </div>
                )}
                {org.shoppingServices && org.shoppingServices.length > 0 && (
                  <div>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">Shopping Services</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {org.shoppingServices.map((s) =>
                        onFilterByValue ? (
                          <button
                            key={s}
                            type="button"
                            onClick={() => onFilterByValue(null, { shopping: s })}
                            className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 cursor-pointer hover:ring-2 hover:ring-gray-300 transition-all"
                            title={`Show all offering ${s}`}
                          >
                            {s}
                          </button>
                        ) : (
                          <span key={s} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{s}</span>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Technology Section — members only */}
      {hasTechData && (
        <div className="relative">
          {!isMember && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl">
              <div className="text-center px-4 py-2.5 rounded-lg bg-white/95 shadow-sm border border-gray-200">
                <svg className="w-4 h-4 text-gray-400 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <p className="text-[11px] font-medium text-gray-600">Members only</p>
              </div>
            </div>
          )}
          <div className={!isMember ? "blur-[6px] opacity-50 pointer-events-none select-none" : ""}>
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Technology</p>
              </div>
              <div className="p-3 space-y-2.5">
                {org.lmsSystem && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] text-gray-500 w-16 flex-shrink-0 uppercase tracking-wider">LMS</span>
                    <span className="text-sm font-medium text-gray-900">{org.lmsSystem}</span>
                  </div>
                )}
                {org.socialMediaPlatforms && org.socialMediaPlatforms.length > 0 && (
                  <div>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">Social Media</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {org.socialMediaPlatforms.map((p) => (
                        <span key={p} className="rounded-md bg-blue-50 border border-blue-100 px-1.5 py-0.5 text-[10px] text-[#D92327]">{p}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Membership CTA for non-members */}
      {!isMember && (hasOperationalData || hasTechData) && (
        <div className="rounded-xl bg-gradient-to-br from-red-50 to-orange-50 border border-red-100 p-3.5 text-center">
          <p className="text-xs text-gray-700 mb-2">
            Become a member to see full operational and benchmarking data.
          </p>
          <Link
            href="/membership"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#EE2A2E] text-white text-xs font-medium rounded-full hover:bg-[#D92327] transition-colors"
          >
            Join CSC
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}

      {/* Actions — visible to all */}
      <div className="space-y-2">
        <Link
          href={`/org/${org.slug}`}
          className="w-full inline-flex items-center justify-center rounded-xl bg-[#EE2A2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#D92327] transition-colors"
        >
          View Full Profile →
        </Link>
        {org.website && (
          <a
            href={org.website}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Visit Website ↗
          </a>
        )}
      </div>

      </> /* end standard view */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function ContactCard({
  contact,
  highlight = false,
}: {
  contact: { name: string; roleTitle: string | null; email: string | null; phone: string | null; avatarUrl: string | null };
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 flex items-start gap-3 ${highlight ? "border-gray-300 bg-white shadow-sm" : "border-gray-200 bg-gray-50"}`}>
      {contact.avatarUrl ? (
        <img src={contact.avatarUrl} alt={contact.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${highlight ? "bg-gray-100" : "bg-gray-200"}`}>
          <span className="text-gray-500 font-semibold text-xs">
            {contact.name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
          </span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={`font-semibold truncate ${highlight ? "text-gray-900 text-sm" : "text-gray-700 text-xs"}`}>{contact.name}</p>
        {contact.roleTitle && (
          <p className="text-xs text-gray-500 truncate">{contact.roleTitle}</p>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="text-xs text-[#EE2A2E] hover:underline truncate block mt-0.5">
            {contact.email}
          </a>
        )}
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="text-xs text-gray-500 hover:text-[#EE2A2E] transition-colors truncate block">
            {contact.phone}
          </a>
        )}
      </div>
    </div>
  );
}

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtMonth(iso: string) {
  if (iso.includes("-")) return MONTH_ABBR[parseInt(iso.split("-")[1] ?? "0") - 1] ?? iso;
  return iso.slice(0, 3);
}

function BuyingWindowChip({ window }: { window: { rfpStart: string | null; rfpEnd: string | null; fiscalYearStart: string | null } }) {
  if (window.rfpStart && window.rfpEnd) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        RFP window: {fmtMonth(window.rfpStart)} – {fmtMonth(window.rfpEnd)}
      </span>
    );
  }
  if (window.rfpStart) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
        RFP from {fmtMonth(window.rfpStart)}
      </span>
    );
  }
  if (window.fiscalYearStart) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 border border-gray-200 px-3 py-1 text-xs text-gray-600">
        Fiscal year starts {fmtMonth(window.fiscalYearStart)}
      </span>
    );
  }
  return null;
}
