"use client";

import Image from "next/image";
import type { BrandColor, Benchmarking } from "@/lib/database.types";
import type { BenchmarkingWithOrg } from "@/lib/data";
import type { VisibleOrganization, VisibleContact } from "@/lib/visibility/data";
import type { ViewerLevel } from "@/lib/visibility/defaults";
import ColorizedImage from "@/components/ui/ColorizedImage";
import { ProtectedSection } from "@/components/ui/GreyBlur";
import BlurredField from "@/components/ui/BlurredField";
import BenchmarkingDetails from "./BenchmarkingDetails";
import BenchmarkingComparison from "./BenchmarkingComparison";
import PartnerViewOfMember from "./PartnerViewOfMember";
import EditableProcurementSection from "./EditableProcurementSection";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToolkit } from "@/components/ui/Toolkit";

interface MemberProfileProps {
  organization: VisibleOrganization;
  contacts: VisibleContact[];
  brandColors: BrandColor[];
  benchmarking: Benchmarking | null;
  allBenchmarking: BenchmarkingWithOrg[];
  viewerLevel: ViewerLevel;
}

export default function MemberProfile({
  organization,
  contacts,
  brandColors,
  benchmarking,
  allBenchmarking,
  viewerLevel,
}: MemberProfileProps) {
  const { permissionState, organizations } = useAuth();
  const { editMode, canEditOrg } = useToolkit();
  const rawPrimaryColor = brandColors[0]?.hex || "#EE2A2E";
  const primaryColor = rawPrimaryColor.startsWith("#") ? rawPrimaryColor : `#${rawPrimaryColor}`;
  const heroImage = organization.hero_image_url || organization.banner_url;

  // Check if current user can edit THIS organization
  const canEditThisOrg = canEditOrg(organization.id);

  // Partners see procurement info instead of benchmarking
  const isPartner = permissionState === "partner";

  // Check if user is org_admin for THIS specific organization (can edit procurement info)
  const isOrgAdminForThisOrg = organizations.some(
    (uo) => uo.organization.id === organization.id && uo.role === "org_admin"
  );

  // Debug log
  console.log("[MemberProfile] permissionState:", permissionState, "isPartner:", isPartner, "isOrgAdmin:", isOrgAdminForThisOrg);

  // ---------------------------------------------------------------------------
  // Helpers for rendering pre-masked contact fields
  // ---------------------------------------------------------------------------

  /** Check if a string looks like a masked teaser (initials, domain-only, etc.) */
  const isMaskedValue = (value: string): boolean => {
    // Masked initials: "J. D." pattern
    if (/^[A-Z]\.\s[A-Z]\.$/.test(value)) return true;
    if (/^([A-Z]\.\s?)+$/.test(value.trim())) return true;
    // Masked email domain: starts with @
    if (value.startsWith("@")) return true;
    // Masked phone: contains bullet chars
    if (value.includes("•")) return true;
    return false;
  };

  /** Render a contact field (email or phone) that may be masked, null, or full */
  const renderContactField = (
    primary: string | null | undefined,
    fallback: string | null | undefined,
    type: "email" | "phone"
  ) => {
    const value = (primary || fallback) as string | null;
    if (!value) return <BlurredField placeholderWidth={type === "email" ? 20 : 12} />;
    if (isMaskedValue(value)) return <BlurredField maskedValue={value} />;
    // Full value — render as clickable link
    if (type === "email") {
      return (
        <a href={`mailto:${value}`} className="hover:text-[#1A1A1A] transition-colors">
          {value}
        </a>
      );
    }
    return (
      <a href={`tel:${value}`} className="hover:text-[#1A1A1A] transition-colors">
        {value}
      </a>
    );
  };

  /** Render an org-level field (email/phone) that may be masked or null */
  const renderOrgField = (
    value: string | null | undefined,
    type: "email" | "phone"
  ) => {
    const v = value as string | null;
    if (!v) return "—";
    if (isMaskedValue(v)) return <BlurredField maskedValue={v} />;
    if (type === "email") {
      return (
        <a href={`mailto:${v}`} className="hover:text-[#1A1A1A] transition-colors">{v}</a>
      );
    }
    return (
      <a href={`tel:${v}`} className="hover:text-[#1A1A1A] transition-colors">{v}</a>
    );
  };

  return (
    <div className="min-h-screen bg-[#EEEEF0] font-[family-name:var(--font-raleway)]">
      {/* Desktop Layout - absolute positioning for precise mockup matching */}
      <div className="hidden lg:block relative min-h-screen">
        {/* Colorized Hero Strip — left: 14.71%, width: 23.79%, full height */}
        <div
          className="absolute top-0 bottom-0 overflow-hidden group"
          style={{ left: '14.71%', width: '23.79%' }}
          data-flaggable
          data-field="organizations.hero_image_url"
          data-entity-id={organization.id}
        >
          {heroImage ? (
            <ColorizedImage
              src={heroImage}
              color={primaryColor}
              alt={`${organization.name} campus`}
              className="w-full h-full"
              intensity={0.6}
            />
          ) : (
            <div className="w-full h-full" style={{ backgroundColor: primaryColor }} />
          )}
          {/* Edit mode overlay - shows upload hint */}
          {editMode && canEditThisOrg && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">
              <div className="bg-white/90 rounded-full p-4 shadow-lg">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                </svg>
              </div>
              <span className="absolute bottom-4 text-white text-sm font-medium">Click to change hero image</span>
            </div>
          )}
        </div>

        {/* Product Overlay — left edge at 13.32%, anchored to bottom */}
        {(organization.product_overlay_url || (editMode && canEditThisOrg)) && (
          <div
            className="absolute z-20 pointer-events-auto flex items-center justify-center group"
            style={{ left: '5.64%', bottom: '0', width: '42.09vw', height: '42.09vw' }}
            data-flaggable
            data-field="organizations.product_overlay_url"
            data-entity-id={organization.id}
          >
            {organization.product_overlay_url ? (
              <Image
                src={organization.product_overlay_url}
                alt="Featured product"
                width={2301}
                height={2301}
                className="max-w-full max-h-full object-contain"
                style={{
                  filter: "drop-shadow(0 25px 50px rgba(0,0,0,0.4))",
                }}
                unoptimized
              />
            ) : null}
            {/* Edit mode overlay - shows upload hint */}
            {editMode && canEditThisOrg && (
              <div className={`absolute inset-0 ${organization.product_overlay_url ? 'bg-black/0 group-hover:bg-black/40' : 'bg-gray-200/50'} transition-colors flex items-center justify-center ${organization.product_overlay_url ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'} cursor-pointer rounded-lg`}>
                <div className="bg-white/90 rounded-full p-3 shadow-lg">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                  </svg>
                </div>
                <span className="absolute bottom-8 text-white text-sm font-medium bg-black/50 px-3 py-1 rounded-full">
                  {organization.product_overlay_url ? 'Change' : 'Add'} product overlay
                </span>
              </div>
            )}
          </div>
        )}

        {/* Content Area — left edge at 51.61%, right padding 8.78% */}
        <div
          className="relative z-10"
          style={{
            marginLeft: '51.61%',
            paddingRight: '8.78%',
            paddingTop: '108px',
            paddingBottom: '64px',
          }}
        >
          {/* Logo — 560x155px area, 62px gap to color swatches */}
          <div style={{ width: '560px', height: '155px', marginBottom: '62px' }} data-flaggable data-field="organizations.logo_url" data-entity-id={organization.id}>
            {organization.logo_horizontal_url ? (
              <Image
                src={organization.logo_horizontal_url}
                alt={organization.name}
                width={560}
                height={155}
                className="w-full h-full object-contain object-left"
                unoptimized
              />
            ) : organization.logo_url ? (
              <Image
                src={organization.logo_url}
                alt={organization.name}
                width={560}
                height={155}
                className="w-full h-full object-contain object-left"
                unoptimized
              />
            ) : (
              <h1 className="text-4xl lg:text-6xl font-bold tracking-tight leading-[0.9] text-[#1A1A1A]">
                {formatSchoolName(organization.name)}
              </h1>
            )}
          </div>

          {/* Brand Color Swatches — grouped by Primary/Secondary */}
          {(brandColors.length > 0 || (editMode && canEditThisOrg)) && (() => {
            const primaryColors = brandColors.filter(c => c.name?.toLowerCase().includes('primary') || (c.sort_order && c.sort_order <= 5));
            const secondaryColors = brandColors.filter(c => c.name?.toLowerCase().includes('secondary') || (c.sort_order && c.sort_order > 5));
            // If no categorization, show all as primary
            const hasCategories = primaryColors.length > 0 && secondaryColors.length > 0;

            return (
              <div className="mb-10 space-y-4">
                {/* Primary Colors — larger, more prominent */}
                <div>
                  {hasCategories && (
                    <span className="text-xs uppercase tracking-wider text-gray-400 font-medium mb-2 block">Primary</span>
                  )}
                  <div className="flex flex-wrap items-center" style={{ gap: '12px' }}>
                    {(hasCategories ? primaryColors : brandColors).map((color) => {
                      const hexColor = normalizeHex(color.hex);
                      return (
                        <div key={color.id} className="relative group">
                          <div
                            className="rounded-full flex items-center justify-center text-sm font-semibold shadow-sm"
                            style={{
                              width: '130px',
                              height: '40px',
                              backgroundColor: hexColor,
                              color: isLightColor(color.hex) ? "#000" : "#fff",
                            }}
                            data-flaggable
                            data-field="brand_colors.hex"
                            data-entity-id={color.id}
                          >
                            {hexColor.toUpperCase()}
                          </div>
                          {/* Delete button - only in edit mode */}
                          {editMode && canEditThisOrg && (
                            <div
                              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                              data-delete-color
                              data-entity-id={color.id}
                            >
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Add primary color button */}
                    {editMode && canEditThisOrg && (
                      <div
                        className="rounded-full flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:border-emerald-400 border-2 border-dashed border-gray-300 cursor-pointer transition-colors"
                        style={{ width: '130px', height: '40px' }}
                        data-add-color
                        data-organization-id={organization.id}
                        data-color-type="primary"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
                {/* Secondary Colors — smaller, subtler */}
                {(hasCategories || (editMode && canEditThisOrg)) && (
                  <div>
                    <span className="text-xs uppercase tracking-wider text-gray-400 font-medium mb-2 block">Secondary</span>
                    <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
                      {secondaryColors.map((color) => {
                        const hexColor = normalizeHex(color.hex);
                        return (
                          <div key={color.id} className="relative group">
                            <div
                              className="rounded-full flex items-center justify-center text-xs font-medium"
                              style={{
                                width: '90px',
                                height: '28px',
                                backgroundColor: hexColor,
                                color: isLightColor(color.hex) ? "#000" : "#fff",
                              }}
                              data-flaggable
                              data-field="brand_colors.hex"
                              data-entity-id={color.id}
                            >
                              {hexColor.toUpperCase()}
                            </div>
                            {/* Delete button - only in edit mode */}
                            {editMode && canEditThisOrg && (
                              <div
                                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                data-delete-color
                                data-entity-id={color.id}
                              >
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* Add secondary color button */}
                      {editMode && canEditThisOrg && (
                        <div
                          className="rounded-full flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:border-emerald-400 border-2 border-dashed border-gray-300 cursor-pointer transition-colors"
                          style={{ width: '90px', height: '28px' }}
                          data-add-color
                          data-organization-id={organization.id}
                          data-color-type="secondary"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Primary Contact — Visible to everyone */}
          <div className="mb-10">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
              Primary Contact
            </h3>
            <div className="flex flex-wrap gap-8 text-gray-500">
              <span data-flaggable data-field="organizations.email" data-entity-id={organization.id}>
                {renderOrgField(organization.email, "email")}
              </span>
              <span data-flaggable data-field="organizations.phone" data-entity-id={organization.id}>
                {renderOrgField(organization.phone, "phone")}
              </span>
              <span data-flaggable data-field="organizations.website" data-entity-id={organization.id}>
                {organization.website ? (
                  <a href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`} target="_blank" rel="noopener noreferrer" className="hover:text-[#1A1A1A] transition-colors">{organization.website}</a>
                ) : "—"}
              </span>
            </div>
          </div>

          {/* Store Information — Visible to everyone */}
          <div className="mb-10">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
              Store Information
            </h3>
            <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
              {(organization.square_footage || benchmarking?.total_square_footage) && (
                <>
                  <span className="text-gray-500">Square Footage</span>
                  <span className="text-[#1A1A1A] font-medium" data-flaggable data-field="organizations.square_footage" data-entity-id={organization.id}>
                    {formatNumber(organization.square_footage || benchmarking?.total_square_footage)} sq ft
                  </span>
                </>
              )}
              {(organization.fte || benchmarking?.fulltime_employees) && (
                <>
                  <span className="text-gray-500">Full-Time Staff</span>
                  <span className="text-[#1A1A1A] font-medium" data-flaggable data-field="organizations.fte" data-entity-id={organization.id}>
                    {organization.fte || benchmarking?.fulltime_employees}
                  </span>
                </>
              )}
              {benchmarking?.enrollment_fte && (
                <>
                  <span className="text-gray-500">Student FTE</span>
                  <span className="text-[#1A1A1A] font-medium" data-flaggable data-field="benchmarking.enrollment_fte" data-entity-id={benchmarking.id}>
                    {formatNumber(benchmarking.enrollment_fte)}
                  </span>
                </>
              )}
              {benchmarking?.num_store_locations && (
                <>
                  <span className="text-gray-500">Store Locations</span>
                  <span className="text-[#1A1A1A] font-medium" data-flaggable data-field="benchmarking.num_store_locations" data-entity-id={benchmarking.id}>
                    {benchmarking.num_store_locations}
                  </span>
                </>
              )}
              {benchmarking?.institution_type && (
                <>
                  <span className="text-gray-500">Institution Type</span>
                  <span className="text-[#1A1A1A] font-medium" data-flaggable data-field="benchmarking.institution_type" data-entity-id={benchmarking.id}>
                    {benchmarking.institution_type}
                  </span>
                </>
              )}
              {benchmarking?.pos_system && (
                <>
                  <span className="text-gray-500">POS System</span>
                  <span className="text-[#1A1A1A] font-medium" data-flaggable data-field="benchmarking.pos_system" data-entity-id={benchmarking.id}>
                    {benchmarking.pos_system}
                  </span>
                </>
              )}
              {!organization.square_footage && !organization.fte && !benchmarking && (
                <>
                  <span className="text-gray-400 col-span-2 italic">
                    Store information not yet available
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Staffing — Names visible to all, contact details blurred for public */}
          {(contacts.length > 0 || (editMode && canEditThisOrg)) && (
            <ProtectedSection
              requiredPermission="partner"
              bannerMessage="Sign in to view full contact details"
              ctaText="Sign In"
              ctaLink="/login"
            >
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                  Staffing
                </h3>
                <table className="w-full text-sm">
                  <tbody>
                    {contacts.map((contact) => (
                      <tr
                        key={contact.id}
                        className="border-b border-gray-200"
                        data-flaggable
                      >
                        <td className="py-2 pr-4 text-[#1A1A1A]" data-flaggable data-field="contacts.name" data-entity-id={contact.id}>
                          {contact.name ? (
                            isMaskedValue(contact.name as string) ? <BlurredField maskedValue={contact.name as string} /> : (
                              contact.circle_id ? (
                                <a href={`/api/circle/profile/${contact.id}`} className="hover:text-[#EE2A2E] transition-colors">{contact.name as string}</a>
                              ) : (contact.name as string)
                            )
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-4 text-gray-400" data-flaggable data-field="contacts.work_email" data-entity-id={contact.id}>
                          {renderContactField(contact.work_email as string | null, contact.email as string | null, "email")}
                        </td>
                        <td className="py-2 pr-4 text-gray-400" data-flaggable data-field="contacts.role_title" data-entity-id={contact.id}>
                          {contact.role_title ? (contact.role_title as string) : <BlurredField placeholderWidth={10} />}
                        </td>
                        <td className="py-2 text-gray-400" data-flaggable data-field="contacts.work_phone_number" data-entity-id={contact.id}>
                          {renderContactField(contact.work_phone_number as string | null, contact.phone as string | null, "phone")}
                        </td>
                        {/* Delete button - only visible in edit mode */}
                        {editMode && canEditThisOrg && (
                          <td
                            className="py-2 pl-4 text-red-400 hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors w-8"
                            data-entity-id={contact.id}
                            data-deletable
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </td>
                        )}
                      </tr>
                    ))}
                    {/* Add Contact row - only visible in edit mode for admins */}
                    {editMode && canEditThisOrg && (
                      <tr
                        className="border-b border-gray-200 hover:bg-emerald-50 cursor-pointer transition-colors"
                        data-add-contact
                        data-organization-id={organization.id}
                      >
                        <td colSpan={5} className="py-3 text-center text-emerald-600 font-medium">
                          <span className="flex items-center justify-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            Add a new contact
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </ProtectedSection>
          )}
        </div>
      </div>

      {/* Conditional Section: Different views based on user type */}
      {isPartner ? (
        /* Partner View — Procurement Information (read-only with permission gating) */
        <PartnerViewOfMember
          organization={organization}
          contacts={contacts}
        />
      ) : isOrgAdminForThisOrg ? (
        /* Org Admin View — Editable Procurement Information */
        <EditableProcurementSection
          organization={organization}
          contacts={contacts}
        />
      ) : (
        /* Member View — Benchmarking Data (Survey Participants Only) */
        benchmarking && allBenchmarking.length > 0 && (
          <div className="bg-white border-t border-gray-200">
            <div className="max-w-7xl mx-auto px-8 py-12">
              {/* Detailed Benchmarking Data */}
              <BenchmarkingDetails
                benchmarking={benchmarking}
                organizationName={organization.name}
              />

              {/* Comparison Table */}
              <div className="mt-12 pt-8 border-t border-gray-200">
                <BenchmarkingComparison
                  allBenchmarking={allBenchmarking}
                  currentOrgId={organization.id}
                />
              </div>
            </div>
          </div>
        )
      )}

      {/* Mobile Layout */}
      <div className="lg:hidden">
        <div className="h-64 relative overflow-hidden">
          {heroImage ? (
            <ColorizedImage
              src={heroImage}
              color={primaryColor}
              alt={`${organization.name} campus`}
              className="w-full h-full"
              intensity={0.6}
            />
          ) : (
            <div className="w-full h-full" style={{ backgroundColor: primaryColor }} />
          )}
          {organization.product_overlay_url && (
            <div className="absolute bottom-0 left-4 translate-y-1/3">
              <Image
                src={organization.product_overlay_url}
                alt="Featured product"
                width={160}
                height={200}
                className="object-contain"
                style={{ filter: "drop-shadow(0 15px 30px rgba(0,0,0,0.4))" }}
                unoptimized
              />
            </div>
          )}
        </div>

        <div className="p-8">
          <div className="mb-6">
            {organization.logo_url ? (
              <Image
                src={organization.logo_url}
                alt={organization.name}
                width={300}
                height={80}
                className="h-16 w-auto object-contain"
                unoptimized
              />
            ) : (
              <h1 className="text-3xl font-bold text-[#1A1A1A]">
                {formatSchoolName(organization.name)}
              </h1>
            )}
          </div>

          {/* Brand Color Swatches — grouped by Primary/Secondary (mobile) */}
          {(brandColors.length > 0 || (editMode && canEditThisOrg)) && (() => {
            const primaryColors = brandColors.filter(c => c.name?.toLowerCase().includes('primary') || (c.sort_order && c.sort_order <= 5));
            const secondaryColors = brandColors.filter(c => c.name?.toLowerCase().includes('secondary') || (c.sort_order && c.sort_order > 5));
            const hasCategories = primaryColors.length > 0 && secondaryColors.length > 0;

            return (
              <div className="mb-8 space-y-3">
                {/* Primary Colors — larger, more prominent */}
                <div>
                  {hasCategories && (
                    <span className="text-xs uppercase tracking-wider text-gray-400 font-medium mb-2 block">Primary</span>
                  )}
                  <div className="flex gap-3 flex-wrap items-center">
                    {(hasCategories ? primaryColors : brandColors).map((color) => {
                      const hexColor = normalizeHex(color.hex);
                      return (
                        <div key={color.id} className="relative group">
                          <div
                            className="rounded-full flex items-center justify-center text-xs font-semibold shadow-sm"
                            style={{
                              width: '110px',
                              height: '34px',
                              backgroundColor: hexColor,
                              color: isLightColor(color.hex) ? "#000" : "#fff",
                            }}
                          >
                            {hexColor.toUpperCase()}
                          </div>
                          {/* Delete button - only in edit mode */}
                          {editMode && canEditThisOrg && (
                            <div
                              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center cursor-pointer"
                              data-delete-color
                              data-entity-id={color.id}
                            >
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Add primary color button */}
                    {editMode && canEditThisOrg && (
                      <div
                        className="rounded-full flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:border-emerald-400 border-2 border-dashed border-gray-300 cursor-pointer transition-colors"
                        style={{ width: '110px', height: '34px' }}
                        data-add-color
                        data-organization-id={organization.id}
                        data-color-type="primary"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
                {/* Secondary Colors — smaller, subtler */}
                {(hasCategories || (editMode && canEditThisOrg)) && (
                  <div>
                    <span className="text-xs uppercase tracking-wider text-gray-400 font-medium mb-2 block">Secondary</span>
                    <div className="flex gap-2 flex-wrap items-center">
                      {secondaryColors.map((color) => {
                        const hexColor = normalizeHex(color.hex);
                        return (
                          <div key={color.id} className="relative group">
                            <div
                              className="rounded-full flex items-center justify-center font-medium"
                              style={{
                                width: '76px',
                                height: '24px',
                                fontSize: '10px',
                                backgroundColor: hexColor,
                                color: isLightColor(color.hex) ? "#000" : "#fff",
                              }}
                            >
                              {hexColor.toUpperCase()}
                            </div>
                            {/* Delete button - only in edit mode */}
                            {editMode && canEditThisOrg && (
                              <div
                                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center cursor-pointer"
                                data-delete-color
                                data-entity-id={color.id}
                              >
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* Add secondary color button */}
                      {editMode && canEditThisOrg && (
                        <div
                          className="rounded-full flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:border-emerald-400 border-2 border-dashed border-gray-300 cursor-pointer transition-colors"
                          style={{ width: '76px', height: '24px' }}
                          data-add-color
                          data-organization-id={organization.id}
                          data-color-type="secondary"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Primary Contact — Visible to everyone */}
          <div className="mb-8">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
              Primary Contact
            </h3>
            <div className="flex flex-wrap gap-4 text-gray-500 text-sm">
              <span data-flaggable data-field="organizations.email" data-entity-id={organization.id}>
                {renderOrgField(organization.email, "email")}
              </span>
              <span data-flaggable data-field="organizations.phone" data-entity-id={organization.id}>
                {renderOrgField(organization.phone, "phone")}
              </span>
              <span data-flaggable data-field="organizations.website" data-entity-id={organization.id}>
                {organization.website ? (
                  <a href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`} target="_blank" rel="noopener noreferrer" className="hover:text-[#1A1A1A] transition-colors">{organization.website}</a>
                ) : "—"}
              </span>
            </div>
          </div>

          {/* Store Information — Visible to everyone */}
          <div className="mb-8">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
              Store Information
            </h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {(organization.square_footage || benchmarking?.total_square_footage) && (
                <>
                  <span className="text-gray-500">Square Footage</span>
                  <span className="text-[#1A1A1A] font-medium" data-flaggable data-field="organizations.square_footage" data-entity-id={organization.id}>
                    {formatNumber(organization.square_footage || benchmarking?.total_square_footage)} sq ft
                  </span>
                </>
              )}
              {(organization.fte || benchmarking?.fulltime_employees) && (
                <>
                  <span className="text-gray-500">Full-Time Staff</span>
                  <span className="text-[#1A1A1A] font-medium" data-flaggable data-field="organizations.fte" data-entity-id={organization.id}>
                    {organization.fte || benchmarking?.fulltime_employees}
                  </span>
                </>
              )}
              {benchmarking?.enrollment_fte && (
                <>
                  <span className="text-gray-500">Student FTE</span>
                  <span className="text-[#1A1A1A] font-medium" data-flaggable data-field="benchmarking.enrollment_fte" data-entity-id={benchmarking.id}>
                    {formatNumber(benchmarking.enrollment_fte)}
                  </span>
                </>
              )}
              {benchmarking?.institution_type && (
                <>
                  <span className="text-gray-500">Institution Type</span>
                  <span className="text-[#1A1A1A] font-medium" data-flaggable data-field="benchmarking.institution_type" data-entity-id={benchmarking.id}>
                    {benchmarking.institution_type}
                  </span>
                </>
              )}
              {!organization.square_footage && !organization.fte && !benchmarking && (
                <span className="text-gray-400 col-span-2 italic">
                  Store information not yet available
                </span>
              )}
            </div>
          </div>

          {/* Staffing — Names visible, contact details blurred for public */}
          {(contacts.length > 0 || (editMode && canEditThisOrg)) && (
            <ProtectedSection
              requiredPermission="partner"
              bannerMessage="Sign in to view full contact details"
              ctaText="Sign In"
              ctaLink="/login"
            >
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                  Staffing
                </h3>
                <div className="space-y-3">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="border-b border-gray-200 pb-3 flex justify-between items-start"
                      data-flaggable
                    >
                      <div className="flex-1">
                        <div className="font-medium text-[#1A1A1A]" data-flaggable data-field="contacts.name" data-entity-id={contact.id}>
                          {contact.name ? (
                            isMaskedValue(contact.name as string) ? <BlurredField maskedValue={contact.name as string} /> : (
                              contact.circle_id ? (
                                <a href={`/api/circle/profile/${contact.id}`} className="hover:text-[#EE2A2E] transition-colors">{contact.name as string}</a>
                              ) : (contact.name as string)
                            )
                          ) : "—"}
                        </div>
                        <div className="text-sm text-gray-400" data-flaggable data-field="contacts.role_title" data-entity-id={contact.id}>
                          {contact.role_title ? (contact.role_title as string) : "—"}
                        </div>
                        <div className="text-sm text-gray-400" data-flaggable data-field="contacts.work_email" data-entity-id={contact.id}>
                          {renderContactField(contact.work_email as string | null, contact.email as string | null, "email")}
                        </div>
                      </div>
                      {/* Delete button - only visible in edit mode */}
                      {editMode && canEditThisOrg && (
                        <div
                          className="ml-2 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer transition-colors"
                          data-entity-id={contact.id}
                          data-deletable
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                          </svg>
                        </div>
                      )}
                    </div>
                  ))}
                  {/* Add Contact row - only visible in edit mode for admins */}
                  {editMode && canEditThisOrg && (
                    <div
                      className="border-b border-gray-200 pb-3 pt-2 hover:bg-emerald-50 cursor-pointer transition-colors text-center"
                      data-add-contact
                      data-organization-id={organization.id}
                    >
                      <span className="flex items-center justify-center gap-2 text-emerald-600 font-medium">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Add a new contact
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </ProtectedSection>
          )}
        </div>
      </div>

      {/* Back Link */}
      <div className="fixed bottom-8 left-8 z-50">
        <Link
          href="/"
          className="flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-sm rounded-full shadow-lg text-gray-600 hover:text-[#1A1A1A] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Network
        </Link>
      </div>
    </div>
  );
}

function formatSchoolName(name: string): React.ReactNode {
  if (name.toLowerCase().startsWith("university of ")) {
    return (<>UNIVERSITY OF<br />{name.slice(14).toUpperCase()}</>);
  }
  if (name.toLowerCase().endsWith(" university")) {
    return (<>{name.slice(0, -11).toUpperCase()}<br />UNIVERSITY</>);
  }
  if (name.toLowerCase().endsWith(" college")) {
    return (<>{name.slice(0, -8).toUpperCase()}<br />COLLEGE</>);
  }
  return name.toUpperCase();
}

function isLightColor(hex: string | null): boolean {
  if (!hex) return false;
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

function normalizeHex(hex: string | null): string {
  if (!hex) return "#888888";
  // Ensure hex has # prefix
  return hex.startsWith("#") ? hex : `#${hex}`;
}

function formatNumber(num: number | null | undefined): string {
  if (num == null) return "";
  return num.toLocaleString();
}
