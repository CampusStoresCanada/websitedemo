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
import { isBenchmarkingSurveyFlag } from "@/lib/circle/flag-routing";
import { buildFlagDm, oneLine } from "@/lib/circle/flag-message";
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
 * Who answers for the survey: whoever holds the committee lead, and nobody else.
 *
 * ⛔ NOT every super admin. The office has three, and two of them have nothing
 * to do with benchmarking — a beta round could easily produce a report a day,
 * and a DM that is nearly always somebody else's job is a DM people learn to
 * ignore. The capability already resolves ex officio holders, so the secretary
 * is in this list without being named in it.
 *
 * Super admins remain the fallback for the case where NOBODY holds the
 * capability, because a flag that reaches no one is worse than a flag that
 * reaches the wrong one. That state is real: the survey has sat with no
 * appointed lead before.
 */
async function benchmarkingRecipients(): Promise<string[]> {
  const adminClient = createAdminClient();

  const { data: leads } = await adminClient
    .from("capability_contributions")
    .select("subject_id")
    .eq("capability", "benchmarking.committee_lead")
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

export async function sendFlagNotification(
  params: FlagNotificationParams
): Promise<{ success: boolean; method?: "circle_dm" | "email" | "none"; error?: string }> {
  const { flagId, pageUrl, elementContent, note, priority, organizationId } = params;

  // ── 1. Find recipient(s) ─────────────────────────────────────────────────

  const adminClient = createAdminClient();
  const supabase = await createClient();

  let recipientEmails: string[] = [];

  /*
    ⛔ A flag raised inside the benchmarking survey goes to the COMMITTEE, never
    to the store's own admins.

    Everywhere else on the site a flag means "this page says something wrong
    about you", so the store that owns the page is exactly who should hear it.
    In the survey it is the reverse: the store is the one reporting, and routing
    by organization_id would have mailed their complaint back to themselves and
    told CSC nothing.
  */
  if (isBenchmarkingSurveyFlag(pageUrl)) {
    recipientEmails = await benchmarkingRecipients();
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
  const dmText = buildFlagDm({
    priorityLabel, who, note, elementContent, survey,
    issuesUrl: `${APP_URL}/benchmarking/admin/issues`,
    reviewLink,
  });

  const emailSubject = priority === "high"
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
  const ghostClient = isCircleConfigured() ? getCircleGhostClient() : null;
  const responders = recipientEmails.filter((e) => e !== params.reporterEmail);
  const room = [...new Set([...(params.reporterEmail ? [params.reporterEmail] : []), ...responders])];

  let anyDm = false;
  let anyEmail = false;

  if (ghostClient && room.length > 0) {
    const result = await ghostClient.sendGroupDirectMessage(room, dmText);
    if (result.success) anyDm = true;
    else console.warn("[flag-notify] Circle group DM failed:", result.error);
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
