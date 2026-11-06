"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { sendFlagDecisionNotification } from "@/lib/circle/flag-notify";
import { fieldKeyFromSelector } from "@/lib/circle/flag-routing";

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
  /**
   * The survey field they were standing on, e.g. `cm_sell_through_pct`.
   *
   * ⛔ Written to the row since the toolkit shipped and read by nothing. Three
   * of Jackie Nguyen's reports came back as three rows whose only distinguishing
   * mark was a wall of section text, which is what made the queue unworkable
   * from a notification. Null when the toolkit could only capture a positional
   * CSS path, which it does when the flagged element is not a field.
   */
  fieldKey: string | null;
}

/** Flags raised from inside the survey, newest first. */
export async function loadSurveyFlags(): Promise<SurveyFlag[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok || !isGlobalAdmin(auth.ctx.globalRole)) return [];

  const db = createAdminClient();
  const { data } = await db
    .from("flags")
    .select(
      "id, page_url, note, priority, status, resolution_notes, flagger_name, element_selector, element_content, created_at, organizations(name)",
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
    fieldKey: fieldKeyFromSelector(r.element_selector as string | null),
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

  /*
    Tell the room. ⛔ This is the half that was missing: the write above is all
    that used to happen, so a member heard that their flag was raised and never
    heard what came of it, and whoever else was asked to work the queue had no
    way to see that somebody already had.

    ⛔ Reopening says nothing. "open" is how a responder puts a row back on the
    pile, usually straight after a mis-click, and announcing it to the store
    would turn our own bookkeeping into a notification about them.

    Best effort, and deliberately not awaited for its result before returning
    success: the decision is written, and Circle being unreachable must not make
    a saved decision look like a failure.
  */
  if (input.status !== "open") {
    const { data: actor } = await db
      .from("profiles")
      .select("display_name")
      .eq("id", auth.ctx.userId)
      .maybeSingle();

    void sendFlagDecisionNotification({
      flagId: input.flagId,
      status: input.status,
      actorName: (actor?.display_name as string | null) ?? null,
    }).then((r) => {
      if (!r.success) console.warn("[benchmarking] decision DM not sent:", r.error);
    });
  }

  return { success: true };
}
