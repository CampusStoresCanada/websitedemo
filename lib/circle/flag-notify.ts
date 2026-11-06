// ---------------------------------------------------------------------------
// Flag notifications — notify admin when a member flags content.
//
// Routing:
//   - Org-specific content (organization_id set) → org admin(s)
//   - Site-wide content (no organization_id)     → super admins
//
// Delivery (in order):
//   1. Circle DM via Admin API v2 (appears from the community admin account)
//   2. Email via Resend if Circle DM can't be sent (e.g. self-DM restriction)
// ---------------------------------------------------------------------------

import { getCircleGhostClient } from "./client";
import { isCircleConfigured } from "./config";
import { sendEmail } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBenchmarkingSurveyFlag, isConferenceAskFlag } from "@/lib/circle/flag-routing";
import { buildAskStaffNote, buildFlagDecisionDm, buildFlagDm, oneLine } from "@/lib/circle/flag-message";
import { createClient } from "@/lib/supabase/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

export interface FlagNotificationParams {
  flagId: string;
  pageUrl: string;
  elementContent: string | null;
  /**
   * What the member actually wrote.
   *
   * ⛔ The point of the whole flag. Without it the DM quotes our own page back
   * at the person who wrote it and says somebody somewhere objects, which is
   * not something anyone can answer — so every notification ended with "go and
   * look at the admin panel" and the conversation died there. Karin's September
   * flag read "Jess isn't at UofT anymore, should update the admin to be April"
   * and the DM carried only the email address she had clicked on.
   */
  note: string | null;
  priority: "normal" | "high";
  organizationId: string | null;
  reporterName: string | null;
  /**
   * The person who raised it, so they can be in the room.
   *
   * ⛔ Required for the conversation to exist at all. Without it the flag is
   * announced at the responders and the reporter is outside the thread, which
   * is the shape that made every flag end in the admin panel.
   */
  reporterEmail: string | null;
}


/**
 * Who answers for the survey: whoever holds Interpretation.
 *
 * ⛔ benchmarking.qa_verify, not committee_lead. Steve's decision, and it is the
 * squad whose job this actually is — judging whether a figure or a question is
 * sound. Reading the capability rather than naming people means the room follows
 * the roster: Kathy Wood holds it by appointment, Sean Bell and Stephen Thomas
 * ex officio, and nobody has to remember to update a list here when that changes.
 *
 * ⚠️ This read committee_lead until 2026-10-05, which left the one appointed
 * interpreter out of every flag conversation while both ex officio leads were in
 * it — so it looked like it worked.
 *
 * ⛔ NOT every super admin. The office has three, and two of them have nothing
 * to do with benchmarking — a beta round could easily produce a report a day,
 * and a DM that is nearly always somebody else's job is a DM people learn to
 * ignore.
 *
 * Super admins remain the fallback for the case where NOBODY holds the
 * capability, because a flag that reaches no one is worse than a flag that
 * reaches the wrong one. That state is real: the survey has sat with nobody
 * appointed before.
 */
/**
 * Who answers a conference ask: CSC staff (Stephen, 2026-10-22) — the host
 * organization's contacts tagged Staff, through the site's one reader of that
 * (getCSCStaff). Super admins remain the fallback below, as for every flag.
 */
async function conferenceAskRecipients(): Promise<string[]> {
  const { getCSCStaff } = await import("@/lib/data");
  const staff = (await getCSCStaff()) as unknown as Array<{ email?: string | null; work_email?: string | null }>;
  return [...new Set(staff.map((s) => s.work_email || s.email).filter((e): e is string => !!e))];
}

async function benchmarkingRecipients(): Promise<string[]> {
  const adminClient = createAdminClient();

  const { data: leads } = await adminClient
    .from("capability_contributions")
    .select("subject_id")
    .eq("capability", "benchmarking.qa_verify")
    .eq("is_active", true);

  let ids = [...new Set((leads ?? []).map((l) => l.subject_id as string))];

  if (ids.length === 0) {
    console.warn(
      "[flag-notify] No benchmarking committee lead appointed; falling back to super admins",
    );
    const { data: superAdmins } = await adminClient
      .from("profiles")
      .select("id")
      .eq("global_role", "super_admin");
    ids = (superAdmins ?? []).map((a) => a.id as string);
  }

  const emails = await Promise.all(
    ids.map(async (id) => {
      const { data } = await adminClient.auth.admin.getUserById(id);
      return data?.user?.email ?? null;
    }),
  );
  return emails.filter((e): e is string => !!e);
}

/**
 * Who answers for this flag.
 *
 * ⛔ Extracted so the DECISION notification routes identically. Circle keys a
 * group DM to its participants, so a resolution sent to even a slightly
 * different set opens a SECOND room and the member never sees the answer in the
 * thread where they raised it. Sharing this function is the mechanism, not
 * tidiness: two copies that drift produce two rooms.
 *
 * ⛔ A flag raised inside the benchmarking survey goes to the COMMITTEE, never
 * to the store's own admins.
 *
 * Everywhere else on the site a flag means "this page says something wrong
 * about you", so the store that owns the page is exactly who should hear it.
 * In the survey it is the reverse: the store is the one reporting, and routing
 * by organization_id would have mailed their complaint back to themselves and
 * told CSC nothing.
 */
async function flagRecipients(
  pageUrl: string,
  organizationId: string | null,
): Promise<string[]> {
  const adminClient = createAdminClient();
  const supabase = await createClient();

  let recipientEmails: string[] = [];

  if (isBenchmarkingSurveyFlag(pageUrl)) {
    recipientEmails = await benchmarkingRecipients();
  } else if (isConferenceAskFlag(pageUrl)) {
    recipientEmails = await conferenceAskRecipients();
  } else if (organizationId) {
    const { data: memberships } = await supabase
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("role", "org_admin")
      .eq("status", "active");

    if (memberships && memberships.length > 0) {
      const emailResults = await Promise.all(
        memberships.map(async (m) => {
          const { data } = await adminClient.auth.admin.getUserById(m.user_id);
          return data?.user?.email ?? null;
        })
      );
      recipientEmails = emailResults.filter((e): e is string => !!e);
    }
  }

  if (recipientEmails.length === 0) {
    const { data: superAdmins } = await supabase
      .from("profiles")
      .select("id")
      .eq("global_role", "super_admin");

    if (superAdmins && superAdmins.length > 0) {
      const emailResults = await Promise.all(
        superAdmins.map(async (a) => {
          const { data } = await adminClient.auth.admin.getUserById(a.id);
          return data?.user?.email ?? null;
        })
      );
      recipientEmails = emailResults.filter((e): e is string => !!e);
    }
  }

  return recipientEmails;
}

/**
 * The room a flag lives in: the reporter plus whoever answers.
 *
 * ⛔ Butler is the sender and is in the room by virtue of sending, so it is not
 * listed. Circle keys the room to its participants, which is why both the
 * opening message and the decision must pass through here — the same set is
 * what makes them one thread instead of two.
 */
function flagRoom(reporterEmail: string | null, recipientEmails: string[]): string[] {
  const responders = recipientEmails.filter((e) => e !== reporterEmail);
  return [...new Set([...(reporterEmail ? [reporterEmail] : []), ...responders])];
}

/**
 * Send one message to a room, honouring the dev intercept.
 *
 * ⛔ The same intercept lib/email/send.ts honours. Butler's DM ignored it once
 * already and messaged real staff from a local server, because every local
 * server shares the live database and the live Circle.
 */
async function sendRoomDm(
  intendedRoom: string[],
  text: string,
): Promise<{ sent: boolean; error?: string }> {
  const ghostClient = isCircleConfigured() ? getCircleGhostClient() : null;
  if (!ghostClient || intendedRoom.length === 0) return { sent: false, error: "No room" };

  const intercept = process.env.DEV_EMAIL_INTERCEPT;
  const room = intercept ? [intercept] : intendedRoom;
  const sentText = intercept
    ? `[DEV — would have gone to: ${intendedRoom.join(", ")}]\n\n${text}`
    : text;

  const result = await ghostClient.sendGroupDirectMessage(room, sentText);
  return { sent: result.success, error: result.error };
}

export async function sendFlagNotification(
  params: FlagNotificationParams
): Promise<{ success: boolean; method?: "circle_dm" | "email" | "none"; error?: string }> {
  const { flagId, pageUrl, elementContent, note, priority, organizationId } = params;

  // ── 1. Find recipient(s) ─────────────────────────────────────────────────

  const recipientEmails = await flagRecipients(pageUrl, organizationId);

  if (recipientEmails.length === 0) {
    console.warn("[flag-notify] No recipients found for flag", flagId);
    return { success: false, error: "No recipients found" };
  }

  // ── 2. Build content ─────────────────────────────────────────────────────

  const pageLink = pageUrl.startsWith("http") ? pageUrl : `${APP_URL}${pageUrl}`;
  const priorityLabel = priority === "high" ? "🔴 HIGH PRIORITY" : "🟡 Normal priority";
  const reviewLink = `${pageLink}${pageLink.includes("?") ? "&" : "?"}flag=${flagId}`;
  const survey = isBenchmarkingSurveyFlag(pageUrl);
  const who = params.reporterName?.trim() || "A CSC member";
  const conferenceAsk = isConferenceAskFlag(pageUrl);
  const dmText = buildFlagDm({
    priorityLabel, who, note, elementContent, survey, conferenceAsk,
    issueLink: `${APP_URL}/benchmarking/admin/issues?flag=${flagId}`,
    reviewLink,
  });

  const emailSubject = conferenceAsk
    ? `${priority === "high" ? "🔴 " : ""}Ask CSC: ${who}`
    : priority === "high"
    ? "🔴 HIGH PRIORITY: Content flagged on CSC site"
    : "Content flagged on CSC site";

  const emailHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#163D6D;margin:0 0 8px;">${priority === "high" ? "🔴 HIGH PRIORITY — " : ""}Content Flagged</h2>
      <p style="color:#6B7280;margin:0 0 20px;font-size:14px;">${who} flagged this as potentially incorrect.</p>
      ${note?.trim() ? `
        <blockquote style="margin:0 0 16px;padding:12px 16px;background:#F3F4F6;border-left:3px solid #163D6D;border-radius:4px;font-size:14px;color:#111827;">
          "${note.trim().slice(0, 600)}"
        </blockquote>` : ""}
      ${elementContent ? `
        <p style="margin:0 0 6px;font-size:12px;color:#6B7280;">They were looking at</p>
        <blockquote style="margin:0 0 20px;padding:10px 14px;background:#FEF9C3;border-left:3px solid #CA8A04;border-radius:4px;font-size:13px;color:#78350F;">
          "${elementContent.replace(/\s+/g, " ").trim().slice(0, 300)}"
        </blockquote>` : ""}
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;width:35%;">Page</td>
          <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;"><a href="${pageLink}" style="color:#163D6D;">${pageLink}</a></td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Priority</td>
          <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;">${priority === "high" ? "🔴 High" : "🟡 Normal"}</td>
        </tr>
      </table>
      <p style="margin:0;">
        <a href="${reviewLink}"
           style="background-color:#163D6D;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
          Review Flag
        </a>
      </p>
    </div>
  `;

  // ── 3. Deliver ───────────────────────────────────────────────────────────

  /*
    One room, containing the person who raised it and the people who answer it.

    ⛔ The flag used to be announced AT the responders and the reporter was never
    in the conversation at all — not when it was raised, not when it was
    resolved. So the only way to reply was the admin panel, and the member who
    took the trouble to tell us something heard nothing back. Everything after
    that is a human talking to a human, which is the point: this opens the room,
    it is not the record. The record is the resolution, and later the appendix
    somebody writes from it.

    Butler is the sender and is in the room by virtue of sending, so it is not
    listed. Circle keys the room to its participants, so each reporter gets one
    continuing thread with whoever currently answers — and nothing exists until
    the first flag.
  */
  const responders = recipientEmails.filter((e) => e !== params.reporterEmail);
  const intendedRoom = flagRoom(params.reporterEmail, recipientEmails);

  let anyDm = false;
  let anyEmail = false;

  const opened = await sendRoomDm(intendedRoom, dmText);
  if (opened.sent) anyDm = true;
  else if (opened.error !== "No room") {
    console.warn("[flag-notify] Circle group DM failed:", opened.error);
  }

  /*
    An Ask CSC room has the asker in it, so it carries only their question
    (Stephen, 2026-10-22: "We need that information, they don't"). The rest —
    priority, their details, the War Room link — goes to CSC staff alone.

    Sent whether or not the room went: if the asker's address is not on
    Circle and the room failed, this is how staff still hear in Circle.
  */
  if (conferenceAsk && responders.length > 0) {
    const note = buildAskStaffNote({ priorityLabel, who, note: params.note, details: elementContent, reviewLink });
    const staff = await sendRoomDm(responders, note);
    if (staff.sent) anyDm = true;
    else if (staff.error !== "No room") {
      console.warn("[flag-notify] Circle staff note failed:", staff.error);
    }
  }

  /*
    Email only when Circle could not be reached at all. A delivered DM already
    notifies everyone in the room through Circle's own settings — that is what
    circle_ios_fallback_text above is for — so mailing on top would be a second
    copy of the same thing.

    ⛔ Responders only. The reporter does not need an email telling them that
    they themselves flagged something.
  */
  if (!anyDm) {
    for (const email of responders) {
      const result = await sendEmail({ to: email, subject: emailSubject, html: emailHtml });
      if (result.success) anyEmail = true;
      else console.warn(`[flag-notify] Email also failed for ${email}:`, result.error);
    }
  }

  const success = anyDm || anyEmail;
  const method = anyDm ? "circle_dm" : anyEmail ? "email" : "none";
  return { success, method };
}

/**
 * Tell the room a flag has been decided.
 *
 * ⛔ The missing half of the round trip. A flag opened a Circle room and then
 * nothing ever closed it: decideSurveyFlag wrote status, resolved_by and
 * resolved_at and returned. So Stephen fixed the question Jackie Nguyen raised,
 * and Sean Bell, who had been asked to work the queue, had no way to know. In
 * Stephen's words to him on 2026-11-06: "I should have sent you a message
 * because I resolved it. Butler ghost has no idea."
 *
 * ⛔ Routed through flagRecipients and flagRoom, the same two functions the
 * opening message uses. Circle keys a group DM to its participants, so this
 * lands in the thread the flag already has. Build the room any other way and
 * the member gets a second, orphaned conversation containing only the answer.
 *
 * Best-effort by contract. The decision is already written and must not roll
 * back because Circle is unreachable, so this reports and never throws.
 */
export async function sendFlagDecisionNotification(input: {
  flagId: string;
  status: "acknowledged" | "resolved" | "dismissed";
  /** Who made the call, so the member hears from a person. */
  actorName: string | null;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const db = createAdminClient();
    const { data: flag } = await db
      .from("flags")
      .select("id, page_url, organization_id, flagger_email, flagger_name, element_content")
      .eq("id", input.flagId)
      .maybeSingle();

    if (!flag) return { success: false, error: "Flag not found" };

    const row = flag as unknown as {
      page_url: string | null;
      organization_id: string | null;
      flagger_email: string | null;
      flagger_name: string | null;
      element_content: string | null;
    };

    const recipientEmails = await flagRecipients(row.page_url ?? "", row.organization_id);
    const room = flagRoom(row.flagger_email, recipientEmails);
    if (room.length === 0) return { success: false, error: "No room" };

    /*
      First name only. The message is addressed TO them in a room they are in,
      and "Jackie Nguyen, that one is sorted" reads like a letter from a bank.
    */
    const who = row.flagger_name?.trim().split(/\s+/)[0] || "Thanks";

    const text = buildFlagDecisionDm({
      status: input.status,
      who,
      actor: input.actorName?.trim() || null,
      elementContent: row.element_content,
    });
    if (!text) return { success: false, error: "No message for that status" };

    const result = await sendRoomDm(room, text);
    if (!result.sent) {
      console.warn("[flag-notify] Decision DM failed:", result.error);
      return { success: false, error: result.error };
    }
    return { success: true };
  } catch (err) {
    console.error("[flag-notify] Decision DM threw:", err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown" };
  }
}
