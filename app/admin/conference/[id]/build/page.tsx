import { getConference } from "@/lib/actions/conference";
import { getBuildWorkspace } from "@/lib/actions/conference-entities";
import { ensureMembershipRenewalEntity } from "@/lib/actions/conference-membership-gate";
import BuildWorkspace from "@/components/admin/conference/BuildWorkspace";

export const metadata = { title: "Build | Conference Admin" };

// The v3 Build interview — one surface that authors every kind via the kind
// registry (lib/conference/entity-kinds.ts). Collapses the Catalog / Floor Plan
// / Schedule tabs. Still isolated alongside the facet code (adopt-or-discard).
export default async function ConferenceBuildPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Auto-provision the membership-renewal entity so it's always searchable
  // as a `requires` target — same idea as ensurePolicyEntityForDocument, just
  // hooked from page load instead of a document-save action since there's no
  // other natural trigger for a singleton, non-document catalog entity.
  await ensureMembershipRenewalEntity(id);
  const [conferenceResult, workspaceResult] = await Promise.all([
    getConference(id),
    getBuildWorkspace(id),
  ]);

  if (!conferenceResult.success || !conferenceResult.data) {
    return <div className="text-center py-12 text-gray-500">Conference not found.</div>;
  }
  if (!workspaceResult.success) {
    return <div className="text-center py-12 text-gray-500">Failed to load: {workspaceResult.error}</div>;
  }

  return <BuildWorkspace conferenceId={conferenceResult.data.id} workspace={workspaceResult.data} />;
}
