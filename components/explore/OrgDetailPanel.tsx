"use client";

import Link from "next/link";
import type { HomeMapOrg } from "@/lib/homepage";
import type { ExploreLens } from "@/lib/explore/types";
import type { CompoundFilters } from "@/lib/explore/types";

interface OrgDetailPanelProps {
  org: HomeMapOrg;
  isMember: boolean;
  contact?: {
    name: string;
    roleTitle: string | null;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
  } | null;
  onClose?: () => void;
  /** When provided, values become clickable to filter by that attribute */
  onFilterByValue?: (lens: ExploreLens, filters: CompoundFilters) => void;
}

/** Org detail panel — rich card with organized sections + membership gating */
export function OrgDetailPanel({ org, isMember, contact, onClose, onFilterByValue }: OrgDetailPanelProps) {
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
    <div className="p-5 space-y-4">
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
        {org.logoUrl ? (
          <img
            src={org.logoUrl}
            alt={org.name}
            className="w-14 h-14 rounded-xl object-contain bg-gray-50 border border-gray-200 flex-shrink-0"
          />
        ) : (
          <div
            className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 ${
              org.type === "Member"
                ? "bg-red-50 border border-red-100"
                : "bg-blue-50 border border-blue-100"
            }`}
          >
            <span
              className={`text-lg font-bold ${
                org.type === "Member" ? "text-red-300" : "text-blue-300"
              }`}
            >
              {org.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
            </span>
          </div>
        )}
        <div className="min-w-0 pt-0.5">
          <h3 className="text-base font-semibold text-gray-900 leading-tight">
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
      </div>

      {/* Primary Contact — member-gated */}
      {contact && (
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
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Primary Contact</p>
              </div>
              <div className="p-3 flex items-start gap-3">
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
            href="/apply/member"
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
    </div>
  );
}
