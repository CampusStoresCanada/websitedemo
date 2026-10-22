"use server";

import { requireAuthenticated, requireConferenceDeskAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export interface FlagRecord {
  id: string;
  page_url: string;
  element_selector: string | null;
  element_content: string | null;
  priority: "normal" | "high";
  note: string | null;
  status: string;
  flagger_name: string | null;
  flagger_email: string;
  created_at: string;
}

export interface ConferenceAsk {
  id: string;
  note: string | null;
  priority: string;
  status: string;
  flaggerName: string | null;
  /** Who they are and where (Ask CSC): store, booth, contact, now and next. */
  details: string | null;
  pageUrl: string;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * The War Room's Asks: what people need from CSC staff during a conference.
 *
 * ⛔ No table of its own — the site's flags, read for one conference, exactly
 * as loadSurveyFlags reads them for the benchmarking survey. An ask is a flag
 * raised on any of this conference's admin pages: the War Room's own "add an
 * ask" box, or the toolkit's Flag on the desk or the badge page. One queue, so
 * an ask is answered from one place whichever page it was raised on.
 */
export async function loadConferenceAsks(conferenceId: string): Promise<ConferenceAsk[]> {
  const auth = await requireConferenceDeskAccess(conferenceId);
  if (!auth.ok) return [];
  const { data } = await createAdminClient()
    .from("flags")
    .select("id, note, priority, status, flagger_name, element_content, page_url, created_at, resolved_at")
    .like("page_url", `/admin/conference/${conferenceId}/%`)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []).map((r) => ({
    id: r.id,
    note: r.note,
    priority: r.priority,
    status: r.status,
    flaggerName: r.flagger_name,
    details: r.element_content,
    pageUrl: r.page_url,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  }));
}

/**
 * "Ask CSC" from someone's own conference page (Stephen, 2026-10-22).
 *
 * ⛔ Not a new channel: it is a flag, through submitFlag, so Butler Ghost opens
 * the same Circle room a flag always does — the asker (when they are on
 * Circle) with CSC staff (isConferenceAskFlag) — and the War Room's Asks keeps
 * it as the record to resolve.
 *
 * What we know about them is gathered HERE, from our own data, not typed by
 * them: who they are, their store, booth, email and phone, and what they are in
 * right now and next — so whoever picks it up can find them.
 */
export async function askCsc(input: {
  conferenceId: string;
  note: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "Sign in to ask CSC." };
  const note = input.note.trim();
  if (!note) return { success: false, error: "Say what you need." };

  const db = createAdminClient();
  const { data: person } = await db
    .from("conference_people")
    .select("id, display_name, contact_id, organization_id, organizations(name)")
    .eq("conference_id", input.conferenceId)
    .eq("user_id", auth.ctx.userId)
    .neq("assignment_status", "canceled")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!person) return { success: false, error: "You're not registered for this conference." };

  const [{ data: contact }, booths, agenda] = await Promise.all([
    person.contact_id
      ? db.from("contacts").select("work_email, email, phone, work_phone_number").eq("id", person.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    import("@/lib/publication/composition-loader").then(({ boothNumbersByOrg }) =>
      boothNumbersByOrg(input.conferenceId)
    ),
    import("@/lib/conference/person-agenda").then(({ loadPersonAgenda }) =>
      loadPersonAgenda(person.id, input.conferenceId)
    ),
  ]);

  const orgName = (person.organizations as { name?: string } | null)?.name ?? null;
  const email = contact?.work_email || contact?.email || auth.ctx.userEmail || null;
  const phone = contact?.phone || contact?.work_phone_number || null;
  const boothNumbers = person.organization_id ? booths.get(person.organization_id) ?? [] : [];

  const lines = [
    [person.display_name, orgName].filter(Boolean).join(" · "),
    [email, phone].filter(Boolean).join(" · "),
    boothNumbers.length ? `Booth ${boothNumbers.join(", ")}` : null,
  ];
  if (agenda.success) {
    const { nowAndNext } = await import("@/lib/conference/agenda");
    const describe = (item: (typeof agenda.data.items)[number]) =>
      [
        item.reason === "meeting" && item.meetingAssignment
          ? `Meeting with ${item.meetingAssignment.exhibitorName}`
          : item.title,
        item.meetingAssignment?.suiteNumber != null ? `Suite ${item.meetingAssignment.suiteNumber}` : item.locationLabel,
      ]
        .filter(Boolean)
        .join(", ");
    const { now, next } = nowAndNext(agenda.data.items, new Date());
    if (now) lines.push(`Now: ${describe(now)}, until ${now.endsAtLocal || now.endsAt}`);
    if (next) lines.push(`Next: ${describe(next)}, ${next.startsAtLocal}`);
  }

  const { submitFlag } = await import("@/lib/actions/submit-flag");
  const result = await submitFlag({
    pageUrl: `/admin/conference/${input.conferenceId}/war-room?ask=${person.id}`,
    priority: "normal",
    note,
    elementContent: lines.filter(Boolean).join("\n"),
    organizationId: person.organization_id ?? undefined,
  });
  return result.success ? { success: true } : { success: false, error: result.error ?? "Couldn't send that." };
}

/**
 * Fetch a single flag for admin review.
 * Returns null if the user doesn't have permission or the flag doesn't exist.
 */
export async function getFlagById(flagId: string): Promise<FlagRecord | null> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const { globalRole, orgAdminOrgIds } = auth.ctx;
  const isAdmin = ["admin", "super_admin"].includes(globalRole);
  const isOrgAdmin = orgAdminOrgIds.length > 0;
  if (!isAdmin && !isOrgAdmin) return null;

  const adminClient = createAdminClient();
  const query = adminClient
    .from("flags")
    .select("id, page_url, element_selector, element_content, priority, note, status, flagger_name, flagger_email, created_at, organization_id")
    .eq("id", flagId)
    .single();

  const { data, error } = await query;
  if (error || !data) return null;

  // Org admins can only review flags for their orgs
  if (!isAdmin && data.organization_id) {
    if (!orgAdminOrgIds.includes(data.organization_id)) return null;
  }

  return data as FlagRecord;
}

/**
 * Mark a flag as resolved.
 */
export async function resolveFlag(
  flagId: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "Not authenticated" };

  const { globalRole, orgAdminOrgIds, userId } = auth.ctx;
  const isAdmin = ["admin", "super_admin"].includes(globalRole);
  const isOrgAdmin = orgAdminOrgIds.length > 0;
  if (!isAdmin && !isOrgAdmin) return { success: false, error: "Forbidden" };

  const adminClient = createAdminClient();

  // Verify access
  const { data: flag } = await adminClient
    .from("flags")
    .select("organization_id")
    .eq("id", flagId)
    .single();

  if (!flag) return { success: false, error: "Flag not found" };

  if (!isAdmin && flag.organization_id && !orgAdminOrgIds.includes(flag.organization_id)) {
    return { success: false, error: "Forbidden" };
  }

  const { error } = await adminClient
    .from("flags")
    .update({
      status: "resolved",
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes?.trim() || null,
    })
    .eq("id", flagId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}
