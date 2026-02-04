"use client";

import Image from "next/image";
import type { Organization, Contact, BrandColor, Benchmarking } from "@/lib/database.types";
import ColorizedImage from "@/components/ui/ColorizedImage";
import Link from "next/link";

interface MemberProfileProps {
  organization: Organization;
  contacts: Contact[];
  brandColors: BrandColor[];
  benchmarking: Benchmarking | null;
}

export default function MemberProfile({
  organization,
  contacts,
  brandColors,
  benchmarking,
}: MemberProfileProps) {
  // Get primary color (first brand color, or fallback to CSC red)
  const primaryColor = brandColors[0]?.hex || "#D60001";
  const secondaryColor = brandColors[1]?.hex || null;

  // Use hero_image_url if available, otherwise fall back to banner_url
  const heroImage = organization.hero_image_url || organization.banner_url;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Main Content Area */}
      <div className="flex flex-col lg:flex-row min-h-screen">
        {/* Left Side - Colorized Hero Image with Product Overlay */}
        <div className="lg:w-1/2 relative">
          {/* Colorized Background */}
          <div className="absolute inset-0">
            {heroImage ? (
              <ColorizedImage
                src={heroImage}
                color={primaryColor}
                alt={`${organization.name} campus`}
                className="w-full h-full"
              />
            ) : (
              <div
                className="w-full h-full"
                style={{ backgroundColor: primaryColor }}
              />
            )}
          </div>

          {/* Product Overlay */}
          {organization.product_overlay_url && (
            <div className="absolute bottom-8 left-8 right-8 lg:bottom-16 lg:left-16 lg:right-16">
              <Image
                src={organization.product_overlay_url}
                alt="Featured product"
                width={400}
                height={500}
                className="object-contain max-h-[60vh] drop-shadow-2xl"
                unoptimized
              />
            </div>
          )}

          {/* Mobile padding for content below */}
          <div className="lg:hidden h-[50vh]" />
        </div>

        {/* Right Side - Info */}
        <div className="lg:w-1/2 p-8 lg:p-16 flex flex-col justify-center relative z-10 bg-black lg:bg-transparent">
          {/* Logo and Name */}
          <div className="flex items-center gap-6 mb-8">
            {organization.logo_url && (
              <div className="w-24 h-24 lg:w-32 lg:h-32 bg-white rounded-xl p-3 flex-shrink-0">
                <Image
                  src={organization.logo_url}
                  alt={organization.name}
                  width={128}
                  height={128}
                  className="w-full h-full object-contain"
                  unoptimized
                />
              </div>
            )}
            <h1 className="text-4xl lg:text-6xl font-bold tracking-tight leading-none">
              {formatSchoolName(organization.name)}
            </h1>
          </div>

          {/* Brand Colors */}
          {brandColors.length > 0 && (
            <div className="flex gap-4 mb-8">
              {brandColors.slice(0, 4).map((color) => (
                <button
                  key={color.id}
                  className="group relative"
                  title={color.name || color.hex || "Brand color"}
                >
                  <div
                    className="w-32 h-12 rounded-full border-2 border-white/20 flex items-center justify-center font-mono text-sm uppercase tracking-wider transition-transform group-hover:scale-105"
                    style={{ backgroundColor: color.hex || "#888" }}
                  >
                    {color.hex}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Contact Row */}
          <div className="flex flex-wrap gap-8 mb-12 text-gray-400">
            {organization.email && (
              <div>
                <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Primary email
                </span>
                <a
                  href={`mailto:${organization.email}`}
                  className="hover:text-white transition-colors"
                >
                  {organization.email}
                </a>
              </div>
            )}
            {organization.phone && (
              <div>
                <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Primary phone
                </span>
                <a
                  href={`tel:${organization.phone}`}
                  className="hover:text-white transition-colors"
                >
                  {organization.phone}
                </a>
              </div>
            )}
            {organization.website && (
              <div>
                <span className="block text-xs uppercase tracking-wider text-gray-500 mb-1">
                  Primary website
                </span>
                <a
                  href={organization.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  {new URL(organization.website).hostname}
                </a>
              </div>
            )}
          </div>

          {/* Stats Grid - from benchmarking */}
          <div className="grid grid-cols-2 gap-x-16 gap-y-6 mb-12">
            <StatItem
              label="Square Footage"
              value={
                benchmarking?.total_square_footage || organization.square_footage
                  ? formatNumber(benchmarking?.total_square_footage || organization.square_footage || 0) + " sq ft"
                  : null
              }
            />
            <StatItem
              label="Full Time Equivalent"
              value={
                benchmarking?.enrollment_fte || organization.fte
                  ? formatNumber(benchmarking?.enrollment_fte || organization.fte || 0) + " students"
                  : null
              }
            />
            <StatItem
              label="Store Locations"
              value={
                benchmarking?.num_store_locations
                  ? benchmarking.num_store_locations.toString()
                  : null
              }
            />
            <StatItem
              label="Institution Type"
              value={benchmarking?.institution_type || organization.organization_type}
            />
          </div>

          {/* Contacts Table */}
          {contacts.length > 0 && (
            <div className="border-t border-white/10 pt-8">
              <table className="w-full">
                <tbody>
                  {contacts.slice(0, 4).map((contact) => (
                    <tr key={contact.id} className="border-b border-white/5">
                      <td className="py-3 pr-4 text-white">
                        {getFirstName(contact.name)}
                      </td>
                      <td className="py-3 pr-4 text-gray-400">
                        {contact.work_email || contact.email || "Email"}
                      </td>
                      <td className="py-3 pr-4 text-gray-400">
                        {contact.role_title || "Role"}
                      </td>
                      <td className="py-3 text-gray-400">
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
          className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
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

// Helper component for stat items
function StatItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span className="block text-gray-400">{label}</span>
      <span className="text-gray-500">{value || "—"}</span>
    </div>
  );
}

// Format school name to split into lines if needed
function formatSchoolName(name: string): React.ReactNode {
  // Check for common patterns like "University of X"
  if (name.toLowerCase().startsWith("university of ")) {
    return (
      <>
        UNIVERSITY OF
        <br />
        {name.slice(14).toUpperCase()}
      </>
    );
  }
  // Check for "X University"
  if (name.toLowerCase().endsWith(" university")) {
    return (
      <>
        {name.slice(0, -11).toUpperCase()}
        <br />
        UNIVERSITY
      </>
    );
  }
  // Check for "X College"
  if (name.toLowerCase().endsWith(" college")) {
    return (
      <>
        {name.slice(0, -8).toUpperCase()}
        <br />
        COLLEGE
      </>
    );
  }
  return name.toUpperCase();
}

// Get first name only (for privacy/logged-out view)
function getFirstName(fullName: string): string {
  return fullName.split(" ")[0];
}

// Format number with commas
function formatNumber(num: number): string {
  return num.toLocaleString();
}
