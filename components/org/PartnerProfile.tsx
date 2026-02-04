"use client";

import Image from "next/image";
import type { Organization, Contact, BrandColor } from "@/lib/database.types";
import ColorizedImage from "@/components/ui/ColorizedImage";
import Link from "next/link";

interface PartnerProfileProps {
  organization: Organization;
  contacts: Contact[];
  brandColors: BrandColor[];
}

export default function PartnerProfile({
  organization,
  contacts,
  brandColors,
}: PartnerProfileProps) {
  // Get primary color (first brand color, or fallback to partner blue)
  const primaryColor = brandColors[0]?.hex || "#1E3A5F";

  // Use hero_image_url if available, otherwise fall back to banner_url
  const heroImage = organization.hero_image_url || organization.banner_url;

  // Get primary contact (first contact in list)
  const primaryContact = contacts[0] || null;

  // Parse categories from primary_category (could be comma-separated)
  const categories = organization.primary_category
    ? organization.primary_category.split(",").map((c) => c.trim())
    : [];

  return (
    <div className="min-h-screen bg-white text-[#1A1A1A]">
      {/* Main Content Area */}
      <div className="flex flex-col lg:flex-row min-h-screen">
        {/* Left Side - Product Screenshots/Collage */}
        <div className="lg:w-1/2 relative bg-slate-100">
          {/* Top colorized hero */}
          {heroImage && (
            <div className="h-1/2 relative overflow-hidden">
              <ColorizedImage
                src={heroImage}
                color={primaryColor}
                alt={`${organization.name} product`}
                className="w-full h-full"
                intensity={0.7}
              />
            </div>
          )}

          {/* Product overlay / highlight */}
          {organization.product_overlay_url && (
            <div className="absolute bottom-8 left-8 right-8 lg:bottom-16 lg:left-16">
              <div className="bg-white rounded-2xl shadow-2xl p-4 max-w-md">
                <Image
                  src={organization.product_overlay_url}
                  alt="Product screenshot"
                  width={600}
                  height={400}
                  className="rounded-lg"
                  unoptimized
                />
              </div>
            </div>
          )}

          {/* Fallback if no images */}
          {!heroImage && !organization.product_overlay_url && (
            <div
              className="w-full h-full min-h-[50vh] flex items-center justify-center"
              style={{ backgroundColor: primaryColor + "20" }}
            >
              <div
                className="text-6xl font-bold opacity-20"
                style={{ color: primaryColor }}
              >
                {organization.name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")}
              </div>
            </div>
          )}

          {/* Mobile padding */}
          <div className="lg:hidden h-[40vh]" />
        </div>

        {/* Right Side - Info */}
        <div className="lg:w-1/2 p-8 lg:p-16 flex flex-col justify-center">
          {/* Logo */}
          {organization.logo_url && (
            <div className="mb-8">
              <Image
                src={organization.logo_url}
                alt={organization.name}
                width={250}
                height={80}
                className="h-16 lg:h-20 w-auto object-contain"
                unoptimized
              />
            </div>
          )}

          {/* Category Badges */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-3 mb-8">
              {categories.map((category, index) => (
                <span
                  key={index}
                  className={`px-6 py-2 rounded-full text-sm font-semibold uppercase tracking-wider ${
                    index === 0
                      ? "text-white"
                      : "bg-[#1A1A1A] text-white"
                  }`}
                  style={index === 0 ? { backgroundColor: primaryColor } : {}}
                >
                  {category}
                </span>
              ))}
            </div>
          )}

          {/* Primary Contact */}
          {primaryContact && (
            <div className="mb-8">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                Primary Contact
              </h3>
              <div className="flex flex-wrap gap-8 text-gray-600">
                <span>{primaryContact.work_email || primaryContact.email || "Primary email"}</span>
                <span>{primaryContact.work_phone_number || primaryContact.phone || "Primary phone"}</span>
                {organization.website && (
                  <a
                    href={organization.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-600 hover:text-[#1A1A1A] transition-colors"
                  >
                    Primary website
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          {organization.company_description && (
            <div className="mb-8">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                Description
              </h3>
              <p className="text-gray-600 leading-relaxed">
                {organization.company_description}
              </p>
            </div>
          )}

          {/* Action Link */}
          {(organization.action_link_url || organization.catalogue_url || organization.website) && (
            <div className="mb-12">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                Action Link
              </h3>
              <p className="text-gray-600">
                {organization.action_link_text || "Visit their website to learn more about their products and services."}
              </p>
              <a
                href={organization.action_link_url || organization.catalogue_url || organization.website || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 mt-4 px-6 py-3 rounded-full font-semibold text-white transition-all hover:opacity-90"
                style={{ backgroundColor: primaryColor }}
              >
                {organization.action_link_text || "Learn More"}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </a>
            </div>
          )}

          {/* Staffing/Contacts Table */}
          {contacts.length > 0 && (
            <div className="border-t border-gray-200 pt-8">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                Staffing
              </h3>
              <table className="w-full">
                <tbody>
                  {contacts.slice(0, 4).map((contact) => (
                    <tr key={contact.id} className="border-b border-gray-100">
                      <td className="py-3 pr-4 text-[#1A1A1A]">
                        {getFirstName(contact.name)}
                      </td>
                      <td className="py-3 pr-4 text-gray-500">
                        {contact.work_email || contact.email || "Email"}
                      </td>
                      <td className="py-3 pr-4 text-gray-500">
                        {contact.role_title || "Role"}
                      </td>
                      <td className="py-3 text-gray-500">
                        {contact.work_phone_number || contact.phone || "Phone"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

// Get first name only (for privacy/logged-out view)
function getFirstName(fullName: string): string {
  return fullName.split(" ")[0];
}
