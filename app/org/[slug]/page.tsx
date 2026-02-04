import { notFound } from "next/navigation";
import { getOrganizationBySlug, getContactsForOrganization } from "@/lib/data";
import OrgProfileHero from "@/components/org/OrgProfileHero";
import OrgDetails from "@/components/org/OrgDetails";
import OrgHighlight from "@/components/org/OrgHighlight";
import OrgLocation from "@/components/org/OrgLocation";
import OrgContacts from "@/components/org/OrgContacts";

// Revalidate every 60 seconds
export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function OrgProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const organization = await getOrganizationBySlug(slug);

  if (!organization) {
    notFound();
  }

  const contacts = await getContactsForOrganization(organization.id);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <OrgProfileHero organization={organization} />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 space-y-12">
            {/* About Section */}
            <OrgDetails organization={organization} />

            {/* Highlight Product */}
            {organization.highlight_product_name && (
              <OrgHighlight organization={organization} />
            )}
          </div>

          {/* Right Column - Sidebar */}
          <div className="space-y-8">
            {/* Location */}
            <OrgLocation organization={organization} />

            {/* Contacts */}
            {contacts.length > 0 && (
              <OrgContacts contacts={contacts} />
            )}

            {/* Quick Links */}
            <div className="bg-slate-50 rounded-2xl p-6">
              <h3 className="font-semibold text-[#1A1A1A] mb-4">Quick Links</h3>
              <div className="space-y-3">
                {organization.website && (
                  <a
                    href={organization.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 text-[#6B6B6B] hover:text-[#D60001] transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    <span>Website</span>
                  </a>
                )}
                {organization.catalogue_url && (
                  <a
                    href={organization.catalogue_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 text-[#6B6B6B] hover:text-[#D60001] transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <span>View Catalogue</span>
                  </a>
                )}
                {organization.email && (
                  <a
                    href={`mailto:${organization.email}`}
                    className="flex items-center gap-3 text-[#6B6B6B] hover:text-[#D60001] transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span>Contact</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Back to Map CTA */}
      <div className="border-t border-[#E5E5E5]">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-[#6B6B6B] hover:text-[#D60001] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Back to Network Map</span>
          </a>
        </div>
      </div>
    </div>
  );
}
