import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { WORKSTREAMS } from "@/lib/benchmarking/committee-workstreams";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import CommitteeConsole from "@/components/benchmarking/committee/CommitteeConsole";

export const metadata = {
  title: "Benchmarking Committee | Campus Stores Canada",
  description: "Your committee remit, who holds what, and how it's going.",
};

export default async function CommitteePage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const { supabase, userId, globalRole, capabilities } = auth.ctx;
  const admin = isGlobalAdmin(globalRole);
  const isLead = capabilities.includes("benchmarking.committee_lead");

  if (!isLead && !admin) redirect("/benchmarking");

  const nowIso = new Date().toISOString();

  // What can this person hand out, and until when?
  const delegable: Record<string, string | null> = {};
  for (const w of WORKSTREAMS) {
    if (admin) {
      delegable[w.capability] = null; // admins have no ceiling
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = (await (supabase as any).rpc("max_delegable_until", {
      p_subject: userId,
      p_child_capability: w.capability,
    })) as { data: string | null };
    delegable[w.capability] = data ?? null;
  }
  const canDelegateAny =
    admin || WORKSTREAMS.some((w) => delegable[w.capability] != null);

  // Who currently holds each benchmarking capability
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: holders } = (await (createAdminClient() as any)
    .from("capability_contributions")
    .select("subject_id, display_name, capability, reason, ends_at")
    .like("capability", "benchmarking.%")
    .is("revoked_at", null)
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .order("display_name")) as { data: any[] | null };

  // ── Progress ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: surveys } = (await (supabase as any)
    .from("benchmarking_surveys")
    .select("*")
    .order("fiscal_year", { ascending: false })
    .limit(1)) as { data: any[] | null };
  const survey = surveys?.[0] ?? null;

  let reviewDone = 0;
  let reviewTotal = 0;
  if (survey) {
    const config = getFieldConfig(survey);
    const flagged = config.sections
      .flatMap((s) => s.fields)
      .filter((f) => f.reviewerNote);
    reviewTotal = flagged.length;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: reviews } = (await (supabase as any)
      .from("benchmarking_field_reviews")
      .select("field_name, status")
      .eq("survey_id", survey.id)
      .neq("status", "pending")) as { data: any[] | null };

    const answeredFields = new Set(
      (reviews ?? []).map((r) => r.field_name as string),
    );
    reviewDone = flagged.filter((f) => answeredFields.has(f.name)).length;
  }

  let recipientsDone = 0;
  let recipientsTotal = 0;
  let recipientsEscalated = 0;
  if (survey) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: recipientRows } = (await (supabase as any)
      .from("benchmarking_recipients")
      .select("status")
      .eq("survey_id", survey.id)) as { data: any[] | null };
    const rows = recipientRows ?? [];
    recipientsTotal = rows.length;
    recipientsDone = rows.filter(
      (r) => r.status === "confirmed" || r.status === "corrected",
    ).length;
    recipientsEscalated = rows.filter((r) => r.status === "escalated").length;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: openFlags } = (await (supabase as any)
    .from("delta_flags")
    .select("id", { count: "exact", head: true })
    .eq("committee_status", "pending")) as { count: number | null };

  return (
    <CommitteeConsole
      isLead={isLead}
      isAdmin={admin}
      canDelegateAny={canDelegateAny}
      delegableUntil={delegable}
      holders={(holders ?? []).map((h) => ({
        subjectId: h.subject_id as string,
        name: (h.display_name as string) ?? "Unknown",
        capability: h.capability as string,
        reason: h.reason as string,
        endsAt: h.ends_at as string,
      }))}
      progress={{
        reviewDone,
        reviewTotal,
        openFlags: openFlags ?? 0,
        recipientsDone,
        recipientsTotal,
        recipientsEscalated,
      }}
    />
  );
}
