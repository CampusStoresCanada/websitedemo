"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * The site-wide flags, read for the benchmarking committee.
 *
 * ⛔ No table of its own. I built benchmarking_issues before checking, and the
 * site already had `flags` with a status, a resolver and resolution notes — so
 * the survey would have had a second reporting system with its own queue, and
 * a member who flagged something would have been answered from one of them
 * depending on which page they were standing on.
 */

export interface SurveyFlag {
  id: string;
  pageUrl: string;
  section: string | null;
  note: string | null;
  priority: string;
  status: string;
  resolutionNotes: string | null;
  flaggerName: string | null;
  organizationName: string | null;
  createdAt: string;
}

/** Flags raised from inside the survey, newest first. */
export async function loadSurveyFlags(): Promise<SurveyFlag[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok || !isGlobalAdmin(auth.ctx.globalRole)) return [];

  const db = createAdminClient();
  const { data } = await db
    .from("flags")
    .select(
      "id, page_url, note, priority, status, resolution_notes, flagger_name, element_content, created_at, organizations(name)",
    )
    .like("page_url", "%/benchmarking/%")
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    pageUrl: (r.page_url as string) ?? "",
    /*
      The section, taken from what they selected. The toolkit records the
      element's own text, and the survey's flaggable element is the section
      panel — so the first line of it is the section heading.
    */
    section: ((r.element_content as string | null) ?? "").split("\n")[0] || null,
    note: (r.note as string | null) ?? null,
    priority: (r.priority as string) ?? "normal",
    status: (r.status as string) ?? "open",
    resolutionNotes: (r.resolution_notes as string | null) ?? null,
    flaggerName: (r.flagger_name as string | null) ?? null,
    organizationName:
      ((r.organizations as { name?: string } | null)?.name as string) ?? null,
    createdAt: (r.created_at as string) ?? "",
  }));
}

export async function decideSurveyFlag(input: {
  flagId: string;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  resolutionNotes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok || !isGlobalAdmin(auth.ctx.globalRole)) {
    return { success: false, error: "Not your call." };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("flags")
    .update({
      status: input.status,
      resolution_notes: input.resolutionNotes?.trim() || null,
      resolved_by: input.status === "open" ? null : auth.ctx.userId,
      resolved_at: input.status === "open" ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.flagId);

  if (error) {
    console.error("[benchmarking] decideSurveyFlag failed:", error);
    return { success: false, error: "Could not save that." };
  }
  return { success: true };
}
