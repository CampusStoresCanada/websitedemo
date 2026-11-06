"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { opensBenchmarkingAdmin } from "@/lib/auth/capability-names";
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
   * The store whose survey this was raised in.
   *
   * ⛔ Derived from the reporter, not read from flags.organization_id, which is
   * NULL on every survey flag ever raised: that column means "the page is about
   * this org", and a survey page is about whoever is filling it. So the queue
   * showed "Unknown store" for all of them, and there was no way to build a link
   * into the submission the report came from.
   *
   * Derived at READ time deliberately, so the reports already sitting in the
   * queue gain it too. Backfilling the column would have fixed only new ones.
   */
  organizationId: string | null;
  /** Who decided it, by name, so the queue says more than that somebody did. */
  resolvedByName: string | null;
  resolvedAt: string | null;
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
  /*
    ⛔ The same gate /benchmarking/admin/[year]/submissions uses, not
    isGlobalAdmin alone. Interpretation is the squad these reports are sent TO —
    flag-notify routes them by benchmarking.qa_verify — and four of the six
    holders are global_role "user", so the notification invited them to a list
    that returned empty. opensBenchmarkingAdmin already means exactly this set;
    its own comment says these holders may "open every member store's submission
    and rule on flagged figures".
  */
  if (!auth.ok) return [];
  if (!isGlobalAdmin(auth.ctx.globalRole) && !opensBenchmarkingAdmin(auth.ctx.capabilities)) {
    return [];
  }

  const db = createAdminClient();
  const { data } = await db
    .from("flags")
    .select(
      "id, page_url, note, priority, status, resolution_notes, flagger_id, flagger_name, element_selector, element_content, created_at, resolved_by, resolved_at, organizations(name)",
    )
    .like("page_url", "%/benchmarking/%")
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  /*
    The reporter's member store, and whoever decided each report. Two lookups
    for the whole queue rather than one per row.

    ⛔ Member stores only. A CSC staffer is attached to the Staff org as well,
    and "the store whose survey this is" is never that one — the same filter
    resolveActingOrg applies, and the bug it exists to prevent.
  */
  const flaggerIds = [...new Set(rows.map((r) => r.flagger_id as string | null).filter(Boolean))] as string[];
  const resolverIds = [...new Set(rows.map((r) => r.resolved_by as string | null).filter(Boolean))] as string[];

  const [links, resolvers] = await Promise.all([
    flaggerIds.length
      ? db
          .from("user_organizations")
          .select("user_id, organizations!inner(id, type)")
          .in("user_id", flaggerIds)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    resolverIds.length
      ? db.from("profiles").select("id, display_name").in("id", resolverIds)
      : Promise.resolve({ data: [] }),
  ]);

  const orgByUser = new Map<string, string>();
  for (const l of (links.data ?? []) as unknown as Record<string, unknown>[]) {
    const org = l.organizations as { id?: string; type?: string } | null;
    if (org?.type === "Member" && org.id) orgByUser.set(l.user_id as string, org.id);
  }

  const nameById = new Map<string, string>();
  for (const pr of (resolvers.data ?? []) as unknown as Record<string, unknown>[]) {
    if (pr.display_name) nameById.set(pr.id as string, pr.display_name as string);
  }

  return rows.map((r) => ({
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
    organizationId: orgByUser.get((r.flagger_id as string) ?? "") ?? null,
    resolvedByName: nameById.get((r.resolved_by as string) ?? "") ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    fieldKey: fieldKeyFromSelector(r.element_selector as string | null),
  }));
}

export async function decideSurveyFlag(input: {
  flagId: string;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  resolutionNotes?: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  // Same gate as the queue that renders the buttons. ⛔ A page whose controls
  // render for someone the action then refuses is worse than no controls.
  if (!auth.ok) return { success: false, error: "Not your call." };
  if (!isGlobalAdmin(auth.ctx.globalRole) && !opensBenchmarkingAdmin(auth.ctx.capabilities)) {
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
