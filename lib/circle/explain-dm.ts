// ---------------------------------------------------------------------------
// Explain DM — routes an explain request to the right person via Circle DM.
//
// Routing rules:
//   - Org-specific content (organization_id set) → org admin(s) of that org
//   - Site-wide content (no organization_id)     → super admins
//
// Delivery:
//   1. If recipient is in Circle: send DM as the asker (real conversation)
//   2. If not: send fallback email with onboarding link
//
// The DM is sent as the asker (not the bot) by minting a headless JWT
// for the asker's email. Jason sees "Stephen sent you a message" in Circle,
// and Circle fires its own email notification.
// ---------------------------------------------------------------------------

import { getCircleClient, getCircleGhostClient } from "./client";
import { isCircleConfigured } from "./config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";
const ONBOARDING_URL = `${APP_URL}/onboarding`;

export interface ExplainNotificationParams {
  /** The user who asked the question */
  askerUserId: string;
  askerEmail: string;
  askerName: string | null;
  /** The org this question is about (null = site-wide → super admin) */
  organizationId: string | null;
  /** The page the question was asked on */
  pageUrl: string;
  /** Text of the element they clicked */
  elementText: string | null;
  /** Their actual question */
  note: string;
  /** The saved request ID — used to build the review link */
  requestId?: string;
}

export async function sendExplainNotification(
  params: ExplainNotificationParams
): Promise<{ success: boolean; method?: "circle_dm" | "email" | "none"; error?: string }> {
  const { askerEmail, askerName, organizationId, pageUrl, elementText, note, requestId } = params;

  // ── 1. Find recipient(s) ─────────────────────────────────────────────────

  const adminClient = createAdminClient();
  const supabase = await createClient();

  let recipientEmails: string[] = [];

  if (organizationId) {
    // Org-specific → find org admins
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
  } else {
    // Site-wide → super admins
    const { data: superAdmins } = await supabase
      .from("profiles")
      .select("id")
      .eq("global_role", "super_admin");

    if (superAdmins && superAdmins.length > 0) {
      const emailResults = await Promise.all(
        superAdmins.map(async (p) => {
          const { data } = await adminClient.auth.admin.getUserById(p.id);
          return data?.user?.email ?? null;
        })
      );
      recipientEmails = emailResults.filter((e): e is string => !!e);
    }
  }

  if (recipientEmails.length === 0) {
    console.warn("[explain-dm] No recipients found for explain request");
    return { success: false, error: "No recipients found" };
  }

  // ── 2. Build message content ─────────────────────────────────────────────

  const askerDisplay = askerName ?? askerEmail;
  const fullPageUrl = pageUrl.startsWith("http") ? pageUrl : `${APP_URL}${pageUrl}`;
  const reviewLink = requestId
    ? `${fullPageUrl}${fullPageUrl.includes("?") ? "&" : "?"}explain=${requestId}`
    : fullPageUrl;

  const messageText = [
    `${askerDisplay} asked a question about content on the CSC site:`,
    "",
    elementText ? `> "${elementText.slice(0, 200)}"` : null,
    "",
    note,
    "",
    `See in context: ${reviewLink}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  // ── 3. Circle DM via Butler Ghost ────────────────────────────────────────

  if (isCircleConfigured()) {
    const ghostClient = getCircleGhostClient()!;
    const dmFailedEmails: string[] = [];

    await Promise.all(
      recipientEmails.map(async (email) => {
        const result = await ghostClient.sendDirectMessage(email, messageText);
        if (!result.success) {
          console.warn("[explain-dm] Circle DM failed for", email, result.error);
          dmFailedEmails.push(email);
        }
      })
    );

    if (dmFailedEmails.length > 0) {
      await sendFallbackEmails(dmFailedEmails, askerDisplay, askerEmail, messageText, fullPageUrl);
    }

    const dmSucceeded = recipientEmails.length - dmFailedEmails.length;
    return { success: true, method: dmSucceeded > 0 ? "circle_dm" : "email" };
  }

  // ── 4. Email fallback ────────────────────────────────────────────────────

  await sendFallbackEmails(recipientEmails, askerDisplay, askerEmail, messageText, reviewLink);
  return { success: true, method: "email" };
}

async function sendFallbackEmails(
  recipientEmails: string[],
  askerDisplay: string,
  askerEmail: string,
  messageText: string,
  reviewLink: string
): Promise<void> {
  const { sendEmail } = await import("@/lib/email/send");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#163D6D;margin:0 0 8px;">Question from a CSC Member</h2>
      <p style="color:#6B7280;margin:0 0 24px;font-size:14px;">
        <strong>${askerDisplay}</strong> asked a question about content on the CSC site.
      </p>
      <blockquote style="margin:0 0 20px;padding:10px 14px;background:#EFF6FF;border-left:3px solid #3B82F6;border-radius:4px;font-size:14px;color:#1E3A5F;white-space:pre-wrap;">${messageText}</blockquote>
      <p style="margin:0 0 8px;font-size:13px;color:#6B7280;">
        Reply directly to <a href="mailto:${askerEmail}" style="color:#163D6D;">${askerEmail}</a>
      </p>
      <p style="margin:16px 0 0;">
        <a href="${reviewLink}" style="background-color:#163D6D;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;font-size:14px;">
          See in context
        </a>
      </p>
    </div>
  `;

  for (const email of recipientEmails) {
    await sendEmail({
      to: email,
      subject: `${askerDisplay} asked a question on the CSC site`,
      html,
      replyTo: askerEmail,
    });
  }
}
