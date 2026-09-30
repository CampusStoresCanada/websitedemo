"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * A respondent saying a question is wrong, from where the question is.
 *
 * ⛔ Never blocks and never validates the complaint. "I do not understand what
 * you mean by this" is the most valuable thing a store can tell us and the
 * least likely thing it will say if the box argues back. The only check is that
 * the person is filling this store's survey.
 */

export interface IssueReport {
  id: string;
  sectionId: string | null;
  fieldName: string | null;
  body: string;
  status: string;
  createdAt: string;
}

export async function reportIssue(input: {
  benchmarkingId: string;
  sectionId?: string | null;
  fieldName?: string | null;
  body: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const body = input.body.trim();
  if (!body) return { success: false, error: "Tell us what went wrong first." };
  if (body.length > 4000) {
    return { success: false, error: "That is longer than we can store. Trim it a little." };
  }

  const db = createAdminClient();
  const { data: row } = await db
    .from("benchmarking")
    .select("organization_id, fiscal_year")
    .eq("id", input.benchmarkingId)
    .maybeSingle();
  if (!row) return { success: false, error: "That submission does not exist." };

  const organizationId = row.organization_id as string;

  /*
    Attached to the store, or staff. ⛔ Deliberately NOT gated on the survey
    being open or the row being a draft: the most useful report is often the one
    somebody writes after submitting, when they have seen what their answers
    added up to.
  */
  if (!isGlobalAdmin(auth.ctx.globalRole)) {
    const { data: link } = await db
      .from("user_organizations")
      .select("role")
      .eq("user_id", auth.ctx.userId)
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .maybeSingle();
    if (!link) return { success: false, error: "That is not your store." };
  }

  const { data, error } = await db
    .from("benchmarking_issues")
    .insert({
      benchmarking_id: input.benchmarkingId,
      organization_id: organizationId,
      fiscal_year: row.fiscal_year as number,
      reported_by: auth.ctx.userId,
      section_id: input.sectionId ?? null,
      field_name: input.fieldName ?? null,
      body,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[benchmarking] reportIssue failed:", error);
    return { success: false, error: "Could not send that. Try again in a moment." };
  }
  return { success: true, id: data.id as string };
}

/** What this store has already reported, so it can see it landed. */
export async function loadMyIssues(benchmarkingId: string): Promise<IssueReport[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];

  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_issues")
    .select("id, section_id, field_name, body, status, created_at")
    .eq("benchmarking_id", benchmarkingId)
    .order("created_at", { ascending: false });

  return (data ?? []).map((r) => ({
    id: r.id as string,
    sectionId: (r.section_id as string | null) ?? null,
    fieldName: (r.field_name as string | null) ?? null,
    body: (r.body as string) ?? "",
    status: (r.status as string) ?? "open",
    createdAt: (r.created_at as string) ?? "",
  }));
}
