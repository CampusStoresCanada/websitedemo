import { notFound } from "next/navigation";
import { getOrganizationProfile } from "@/lib/data";
import MemberProfile from "@/components/org/MemberProfile";
import PartnerProfile from "@/components/org/PartnerProfile";

// Revalidate every 60 seconds
export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function OrgProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const { organization, contacts, brandColors, benchmarking } =
    await getOrganizationProfile(slug);

  if (!organization) {
    notFound();
  }

  // Render different layouts based on organization type
  if (organization.type === "Member") {
    return (
      <MemberProfile
        organization={organization}
        contacts={contacts}
        brandColors={brandColors}
        benchmarking={benchmarking}
      />
    );
  }

  // Partner/Vendor layout
  return (
    <PartnerProfile
      organization={organization}
      contacts={contacts}
      brandColors={brandColors}
    />
  );
}
