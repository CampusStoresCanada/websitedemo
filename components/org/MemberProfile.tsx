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
  const primaryColor = brandColors[0]?.hex || "#D60001";
  const heroImage = organization.hero_image_url || organization.banner_url;

  return (
    <div className="min-h-screen bg-[#EEEEF0]">
      <div className="flex min-h-screen pl-[10%]">
        {/* Colorized Hero - exactly 23.87% width, with space on left */}
        <div className="hidden lg:block relative" style={{ width: '23.87%' }}>
          <div className="absolute inset-0 overflow-hidden">
            {heroImage ? (
              <ColorizedImage
                src={heroImage}
                color={primaryColor}
                alt={`${organization.name} campus`}
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full" style={{ backgroundColor: primaryColor }} />
            )}
          </div>
        </div>

        {/* Product Overlay - crosses the boundary */}
        {organization.product_overlay_url && (
          <div
            className="hidden lg:block absolute z-20 pointer-events-none"
            style={{ left: '10%', bottom: '5%' }}
          >
            <Image
              src={organization.product_overlay_url}
              alt="Featured product"
              width={400}
              height={500}
              className="object-contain"
              style={{
                maxHeight: '80vh',
                filter: "drop-shadow(0 25px 50px rgba(0,0,0,0.4))",
              }}
              unoptimized
            />
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 p-8 lg:py-16 lg:px-20 flex flex-col justify-center">
          {/* Mobile hero */}
          <div className="lg:hidden mb-8 -mx-8 -mt-8 h-64 relative overflow-hidden">
            {heroImage ? (
              <ColorizedImage
                src={heroImage}
                color={primaryColor}
                alt={`${organization.name} campus`}
                className="w-full h-full"
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

          {/* Logo and Name */}
          <div className="flex items-center gap-6 mb-8">
            {organization.logo_url && (
              <div className="w-24 h-24 lg:w-28 lg:h-28 flex-shrink-0">
                <Image
                  src={organization.logo_url}
                  alt={organization.name}
                  width={112}
                  height={112}
                  className="w-full h-full object-contain"
                  unoptimized
                />
              </div>
            )}
            <h1 className="text-4xl lg:text-6xl font-bold tracking-tight leading-[0.9] text-[#1A1A1A]">
              {formatSchoolName(organization.name)}
            </h1>
          </div>

          {/* Brand Colors */}
          {brandColors.length > 0 && (
            <div className="flex gap-4 mb-10">
              {brandColors.map((color) => (
                <div
                  key={color.id}
                  className="w-36 h-11 rounded-full flex items-center justify-center font-mono text-sm uppercase tracking-wider"
                  style={{
                    backgroundColor: color.hex || "#888",
                    color: isLightColor(color.hex) ? "#000" : "#fff",
                  }}
                >
                  {color.hex}
                </div>
              ))}
            </div>
          )}

          {/* Primary Contact */}
          <div className="mb-10">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
              Primary Contact
            </h3>
            <div className="flex flex-wrap gap-8 text-gray-500">
              <span>{organization.email || "Primary email"}</span>
              <span>{organization.phone || "Primary phone"}</span>
              <span>{organization.website ? "Primary website" : "Primary website"}</span>
            </div>
          </div>

          {/* Store Information */}
          <div className="mb-10">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
              Store Information
            </h3>
            <div className="grid grid-cols-2 gap-x-12 gap-y-1 text-sm">
              <span className="text-gray-600">Square Footage</span>
              <span className="text-gray-400">Full Time Equivalent</span>
              <span className="text-gray-600">Other information</span>
              <span className="text-gray-400">Things that are important</span>
            </div>
          </div>

          {/* Staffing */}
          {contacts.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                Staffing
              </h3>
              <table className="w-full text-sm">
                <tbody>
                  {contacts.map((contact) => (
                    <tr key={contact.id} className="border-b border-gray-200">
                      <td className="py-2 pr-4 text-[#1A1A1A]">{getFirstName(contact.name)}</td>
                      <td className="py-2 pr-4 text-gray-400">{contact.work_email || contact.email || "Email"}</td>
                      <td className="py-2 pr-4 text-gray-400">{contact.role_title || "Something"}</td>
                      <td className="py-2 text-gray-400">{contact.work_phone_number || contact.phone || "Phone"}</td>
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

function getFirstName(fullName: string): string {
  return fullName.split(" ")[0];
}

function isLightColor(hex: string | null): boolean {
  if (!hex) return false;
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}
