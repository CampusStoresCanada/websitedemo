import { redirect } from "next/navigation";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import NotesQueue from "@/components/benchmarking/admin/NotesQueue";

export const metadata = {
  title: "Explanations awaiting you | Campus Stores Canada",
  description: "Approve, decline or publish the notes reviewers have written.",
};

/**
 * The committee lead's queue.
 *
 * Two piles, and the second is the one that needs judgement:
 *
 *   secretary_review   a reviewer has written an explanation and it needs a
 *                      yes or no before the store ever sees it.
 *   respondent_review  the store was asked and has not answered. Silence is a
 *                      legitimate answer and never publishes on its own — the
 *                      only way past it is a deliberate override with a written
 *                      reason attached.
 *
 * Gated on the capability rather than on being Sean, so it becomes the next
 * secretary's queue the day the office changes hands.
 */
export default async function BenchmarkingNotesPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const { globalRole, capabilities } = auth.ctx;
  const isLead =
    isGlobalAdmin(globalRole) ||
    capabilities.includes("benchmarking.committee_lead");
  if (!isLead) redirect("/benchmarking");

  const db = createAdminClient();

  const { data: notes } = await db
    .from("benchmarking_notes")
    .select(
      "id, organization_id, field_name, note, status, created_at, respondent_at, respondent_decision, published_on_override, override_reason, organizations(name)",
    )
    .in("status", ["secretary_review", "respondent_review"])
    .order("created_at", { ascending: true });

  const rows = (notes ?? []).map((n) => {
    const org = n.organizations as unknown as { name?: string } | null;
    return {
      id: n.id as string,
      organizationName: org?.name ?? "Unknown store",
      fieldName: n.field_name as string,
      note: n.note as string,
      status: n.status as "secretary_review" | "respondent_review",
      createdAt: n.created_at as string,
      // How long the store has had it. A note sitting unanswered for three
      // weeks is a different decision from one sent yesterday.
      askedAt: (n.respondent_at as string) ?? null,
      respondentDecision: (n.respondent_decision as string) ?? null,
      publishedOnOverride: n.published_on_override === true,
      overrideReason: (n.override_reason as string) ?? null,
    };
  });

  return <NotesQueue rows={rows} />;
}
