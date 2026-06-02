/**
 * RFP notifications — fired after a new RFP is posted.
 *
 * Finds all users in Partner/Vendor orgs whose primary_category contains
 * an exact match on one of the RFP's subcategories, then delivers:
 *   1. Ghost Butler DM (if recipient is in Circle)
 *   2. Email fallback (always attempted)
 *
 * Fire-and-forget — errors are logged but never bubble up to the caller.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { sendCircleNotification } from "@/lib/circle/notifications";
import { sendEmail } from "@/lib/email/send";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";

interface NotifyRFPParams {
  rfpId: string;
  title: string;
  description: string | null;
  category: string;
  subcategories: string[];
  orgName: string;
  orgSlug: string;
  closesAt: string;
  visibility: string;
}

export async function notifyMatchingPartners(params: NotifyRFPParams): Promise<void> {
  if (!params.subcategories.length) return;

  const db = createAdminClient();

  // Find users in active Partner/Vendor orgs whose primary_category contains
  // an exact subcategory match. primary_category is stored as a comma-separated
  // string — we split it server-side and check for array overlap.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: recipients, error } = await (db as any).rpc(
    "find_rfp_notification_recipients",
    {
      p_subcategories: params.subcategories,
      p_visibility: params.visibility,
    }
  ) as { data: Array<{ user_id: string; email: string; display_name: string | null }> | null; error: unknown };

  if (error) {
    console.error("[rfp/notify] recipient query failed:", error);
    return;
  }

  if (!recipients?.length) return;

  const rfpUrl = `${APP_URL}/org/${params.orgSlug}`;
  const closingDate = new Date(
    params.closesAt.endsWith("Z") || params.closesAt.includes("+")
      ? params.closesAt
      : params.closesAt.replace(" ", "T") + "Z"
  ).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

  const dmMessage = [
    `📋 New RFP: ${params.title}`,
    ``,
    `Posted by ${params.orgName}`,
    params.description ? params.description : null,
    ``,
    `Category: ${params.category} → ${params.subcategories.join(", ")}`,
    `Closes: ${closingDate}`,
    ``,
    rfpUrl,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const emailHtml = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1A1A1A; margin: 0 0 8px;">New RFP matching your categories</h2>
      <p style="color: #6B7280; font-size: 14px; margin: 0 0 24px;">
        ${params.orgName} has posted an RFP in a category you work with.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <tr>
          <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;width:35%;">RFP</td>
          <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#1A1A1A;">${params.title}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;">Posted by</td>
          <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;">${params.orgName}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;">Category</td>
          <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;">${params.category} → ${params.subcategories.join(", ")}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;">Closes</td>
          <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;">${closingDate}</td>
        </tr>
        ${params.description ? `
        <tr>
          <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;">Summary</td>
          <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#6B7280;">${params.description}</td>
        </tr>` : ""}
      </table>
      <p style="margin: 24px 0;">
        <a href="${rfpUrl}"
           style="background-color:#EE2A2E;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
          View RFP
        </a>
      </p>
      <p style="color:#9CA3AF;font-size:12px;">
        You're receiving this because your organization is listed under
        ${params.subcategories.join(", ")} on Campus Stores Canada.
      </p>
    </div>
  `;

  // Send to each recipient — DM first, email always
  const sends = recipients.map(async (r) => {
    // Ghost Butler DM (non-fatal if Circle isn't configured or user isn't in Circle)
    void sendCircleNotification({
      recipientEmail: r.email,
      message: dmMessage,
    }).catch((e) => console.warn("[rfp/notify] DM failed for", r.email, e));

    // Email — always sent
    const greeting = r.display_name ? `Hi ${r.display_name.split(" ")[0]},` : "Hi,";
    await sendEmail({
      to: r.email,
      subject: `New RFP: ${params.title} — ${params.orgName}`,
      html: `<p style="font-family:sans-serif;margin:0 0 16px;">${greeting}</p>${emailHtml}`,
    }).catch((e) => console.error("[rfp/notify] email failed for", r.email, e));
  });

  await Promise.allSettled(sends);
}
