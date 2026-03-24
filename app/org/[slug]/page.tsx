import { notFound } from "next/navigation";
import { getViewerContext } from "@/lib/visibility/viewer";
import { getOrganizationForViewer } from "@/lib/visibility/data";
import MemberProfile from "@/components/org/MemberProfile";
import PartnerProfile from "@/components/org/PartnerProfile";

// Viewer-dependent masking means different responses per viewer
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function OrgProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const viewer = await getViewerContext();
  const { organization, contacts, brandColors, benchmarking, allBenchmarking } =
    await getOrganizationForViewer(slug, viewer);

  if (!organization) {
    notFound();
  }

  console.log(`[org/${slug}] viewer=${viewer.viewerLevel} contacts sample: ${JSON.stringify(contacts.slice(0,3).map(c => ({ id: c.id, name: c.name, circle_id: (c as Record<string,unknown>).circle_id })))}`);

  // Render different layouts based on organization type
  if (organization.type === "Member") {
    return (
      <MemberProfile
        organization={organization}
        contacts={contacts}
        brandColors={brandColors}
        benchmarking={benchmarking}
        allBenchmarking={allBenchmarking}
        viewerLevel={viewer.viewerLevel}
      />
    );
  }

  // Partner/Vendor layout
  return (
    <PartnerProfile
      organization={organization}
      contacts={contacts}
      brandColors={brandColors}
      viewerLevel={viewer.viewerLevel}
    />
  );
}
