"use client";

import Image from "next/image";
import type { BrandColor } from "@/lib/database.types";
import type { VisibleOrganization, VisibleContact } from "@/lib/visibility/data";
import type { ViewerLevel } from "@/lib/visibility/defaults";
import ColorizedImage from "@/components/ui/ColorizedImage";
import { ProtectedSection } from "@/components/ui/GreyBlur";
import BlurredField from "@/components/ui/BlurredField";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToolkit } from "@/components/ui/Toolkit";

interface PartnerProfileProps {
  organization: VisibleOrganization;
  contacts: VisibleContact[];
  brandColors: BrandColor[];
  viewerLevel: ViewerLevel;
}

export default function PartnerProfile({
  organization,
  contacts,
  brandColors,
  viewerLevel,
}: PartnerProfileProps) {
  const { permissionState, organizations } = useAuth();
  const { editMode, canEditOrg } = useToolkit();

  // Check if current user can edit THIS organization
  const canEditThisOrg = canEditOrg(organization.id);

  // Check if user is org_admin for THIS specific organization
  const isOrgAdminForThisOrg = organizations.some(
    (uo) => uo.organization.id === organization.id && uo.role === "org_admin"
  );

  // Debug log
  console.log("[PartnerProfile] permissionState:", permissionState, "isOrgAdmin:", isOrgAdminForThisOrg);

  // ---------------------------------------------------------------------------
  // Helpers for rendering pre-masked contact fields
  // ---------------------------------------------------------------------------

  /** Check if a string looks like a masked teaser (initials, domain-only, etc.) */
  const isMaskedValue = (value: string): boolean => {
    if (/^[A-Z]\.\s[A-Z]\.$/.test(value)) return true;
    if (/^([A-Z]\.\s?)+$/.test(value.trim())) return true;
    if (value.startsWith("@")) return true;
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

  // Get primary color (first brand color, or fallback to partner blue)
  const rawPrimaryColor = brandColors[0]?.hex || "#1E3A5F";
  const primaryColor = rawPrimaryColor.startsWith("#") ? rawPrimaryColor : `#${rawPrimaryColor}`;

  // Use hero_image_url if available, otherwise fall back to banner_url
  const heroImage = organization.hero_image_url || organization.banner_url;

  // Get primary contact (first contact in list)
  const primaryContact = contacts[0] || null;

  // Parse categories from primary_category (could be comma-separated)
  const categories = organization.primary_category
    ? organization.primary_category.split(",").map((c) => c.trim())
    : [];

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
              alt={`${organization.name} product`}
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

        {/* Product Overlay — left edge at 5.64%, anchored to bottom */}
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
          {/* Logo — 560x155px area */}
          <div style={{ width: '560px', height: '155px', marginBottom: '62px' }} data-flaggable data-field="organizations.logo_url" data-entity-id={organization.id}>
            {organization.logo_url ? (
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
                {organization.name.toUpperCase()}
              </h1>
            )}
          </div>

          {/* Category Badges - double stroke: white inner, color outer */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-10">
              {categories.map((category, index) => (
                <span
                  key={index}
                  className="px-6 py-2 rounded-full text-sm font-semibold uppercase tracking-wider bg-transparent"
                  style={{
                    color: index === 0 ? primaryColor : "#1A1A1A",
                    boxShadow: `0 0 0 2px white, 0 0 0 4px ${index === 0 ? primaryColor : "#1A1A1A"}`,
                  }}
                >
                  {category}
                </span>
              ))}
            </div>
          )}

          {/* Primary Contact — Partners and above can see, public needs to sign in */}
          {primaryContact && (
            <ProtectedSection
              requiredPermission="partner"
              bannerMessage="Sign in to view contact details"
              ctaText="Sign In"
              ctaLink="/login"
            >
              <div className="mb-10">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                  Primary Contact
                </h3>
                <div className="flex flex-wrap gap-8 text-gray-500">
                  <span data-flaggable data-field="contacts.work_email" data-entity-id={primaryContact.id}>
                    {renderContactField(primaryContact.work_email as string | null, primaryContact.email as string | null, "email")}
                  </span>
                  <span data-flaggable data-field="contacts.work_phone_number" data-entity-id={primaryContact.id}>
                    {renderContactField(primaryContact.work_phone_number as string | null, primaryContact.phone as string | null, "phone")}
                  </span>
                  <span data-flaggable data-field="organizations.website" data-entity-id={organization.id}>
                    {organization.website ? (
                      <a
                        href={(organization.website as string).startsWith('http') ? (organization.website as string) : `https://${organization.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[#1A1A1A] transition-colors"
                      >
                        {organization.website as string}
                      </a>
                    ) : "—"}
                  </span>
                </div>
              </div>
            </ProtectedSection>
          )}

          {/* Description */}
          {organization.company_description && (
            <div className="mb-10">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                Description
              </h3>
              <p className="text-gray-600 leading-relaxed" data-flaggable data-field="organizations.company_description" data-entity-id={organization.id}>
                {organization.company_description}
              </p>
            </div>
          )}

          {/* Action Link */}
          {(organization.action_link_url || organization.catalogue_url || organization.website) && (
            <div className="mb-12">
              <a
                href={organization.action_link_url || organization.catalogue_url || organization.website || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-white transition-all hover:opacity-90"
                style={{ backgroundColor: primaryColor }}
              >
                {organization.action_link_text || "Learn More"}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </a>
            </div>
          )}

          {/* Staffing/Contacts Table — Partners and above can see, public needs to sign in */}
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
                            isMaskedValue(contact.name as string) ? <BlurredField maskedValue={contact.name as string} /> : (contact.name as string)
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-4 text-gray-400" data-flaggable data-field="contacts.work_email" data-entity-id={contact.id}>
                          {renderContactField(contact.work_email as string | null, contact.email as string | null, "email")}
                        </td>
                        <td className="py-2 pr-4 text-gray-400" data-flaggable data-field="contacts.role_title" data-entity-id={contact.id}>
                          {contact.role_title ? (contact.role_title as string) : "—"}
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

      {/* Mobile Layout */}
      <div className="lg:hidden">
        <div className="h-64 relative overflow-hidden">
          {heroImage ? (
            <ColorizedImage
              src={heroImage}
              color={primaryColor}
              alt={`${organization.name} product`}
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
          {/* Logo */}
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
                {organization.name.toUpperCase()}
              </h1>
            )}
          </div>

          {/* Category Badges */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {categories.map((category, index) => (
                <span
                  key={index}
                  className="px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-transparent"
                  style={{
                    color: index === 0 ? primaryColor : "#1A1A1A",
                    boxShadow: `0 0 0 2px white, 0 0 0 3px ${index === 0 ? primaryColor : "#1A1A1A"}`,
                  }}
                >
                  {category}
                </span>
              ))}
            </div>
          )}

          {/* Primary Contact — Partners and above can see */}
          {primaryContact && (
            <ProtectedSection
              requiredPermission="partner"
              bannerMessage="Sign in to view contact details"
              ctaText="Sign In"
              ctaLink="/login"
            >
              <div className="mb-8">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                  Primary Contact
                </h3>
                <div className="flex flex-wrap gap-4 text-gray-500 text-sm">
                  <span data-flaggable data-field="contacts.work_email" data-entity-id={primaryContact.id}>
                    {renderContactField(primaryContact.work_email as string | null, primaryContact.email as string | null, "email")}
                  </span>
                  <span data-flaggable data-field="contacts.work_phone_number" data-entity-id={primaryContact.id}>
                    {renderContactField(primaryContact.work_phone_number as string | null, primaryContact.phone as string | null, "phone")}
                  </span>
                  <span data-flaggable data-field="organizations.website" data-entity-id={organization.id}>
                    {organization.website ? (
                      <a href={(organization.website as string).startsWith('http') ? (organization.website as string) : `https://${organization.website}`} target="_blank" rel="noopener noreferrer" className="hover:text-[#1A1A1A] transition-colors">{organization.website as string}</a>
                    ) : "—"}
                  </span>
                </div>
              </div>
            </ProtectedSection>
          )}

          {/* Description */}
          {organization.company_description && (
            <div className="mb-8">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                Description
              </h3>
              <p className="text-gray-600 text-sm leading-relaxed" data-flaggable data-field="organizations.company_description" data-entity-id={organization.id}>
                {organization.company_description}
              </p>
            </div>
          )}

          {/* Action Link */}
          {(organization.action_link_url || organization.catalogue_url || organization.website) && (
            <div className="mb-8">
              <a
                href={organization.action_link_url || organization.catalogue_url || organization.website || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-white text-sm transition-all hover:opacity-90"
                style={{ backgroundColor: primaryColor }}
              >
                {organization.action_link_text || "Learn More"}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </a>
            </div>
          )}

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
                            isMaskedValue(contact.name as string) ? <BlurredField maskedValue={contact.name as string} /> : (contact.name as string)
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
