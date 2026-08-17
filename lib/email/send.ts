import { Resend } from "resend";
import { wrapEmailBody } from "./layout";
import { getPlatformIdentity } from "@/lib/data";

const resend = new Resend(process.env.RESEND_API_KEY);

async function resolveFromAddress(): Promise<string> {
  const identity = await getPlatformIdentity();
  const domain = identity.clientDomain || "example.com";
  return `${identity.clientName} <noreply@${domain}>`;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string | Buffer }>;
  /** Per-recipient unsubscribe/preferences link — see wrapEmailBody. Omit for transactional app emails. */
  manageUrl?: string;
}

export interface BatchSendItem {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /** Per-recipient unsubscribe/preferences link — see wrapEmailBody. Omit for transactional app emails. */
  manageUrl?: string;
}

export interface BatchSendResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

const BATCH_CHUNK_SIZE = 100; // Resend's batch endpoint limit per call

/**
 * Send many emails via Resend's batch endpoint, chunked to its 100-per-call
 * limit — one request per up-to-100 recipients instead of one request per
 * recipient. Used for campaign sends so a few-hundred-person send finishes
 * in a handful of round trips instead of racking up hundreds of sequential
 * ones (which risks both the team-wide rate limit and the function's time
 * budget). `batchValidation: "permissive"` means one bad address in a chunk
 * fails just that item, not the whole chunk.
 */
export async function sendEmailBatch(items: BatchSendItem[]): Promise<BatchSendResult[]> {
  const intercept = process.env.DEV_EMAIL_INTERCEPT;
  const fromAddress = await resolveFromAddress();
  const identity = await getPlatformIdentity();
  const results: BatchSendResult[] = new Array(items.length);

  for (let start = 0; start < items.length; start += BATCH_CHUNK_SIZE) {
    const chunk = items.slice(start, start + BATCH_CHUNK_SIZE);

    const payload = await Promise.all(
      chunk.map(async (item) => ({
        from: fromAddress,
        to: intercept ?? item.to,
        subject: intercept ? `[DEV → ${item.to}] ${item.subject}` : item.subject,
        html: await wrapEmailBody(item.html, undefined, item.manageUrl, identity),
        replyTo: item.replyTo,
      }))
    );

    try {
      const { data, error } = await resend.batch.send(payload, {
        batchValidation: "permissive",
      });

      if (error) {
        for (let i = 0; i < chunk.length; i++) {
          results[start + i] = { success: false, error: error.message };
        }
        continue;
      }

      const failedByIndex = new Map(data.errors.map((e) => [e.index, e.message]));
      chunk.forEach((_, i) => {
        const failMessage = failedByIndex.get(i);
        results[start + i] = failMessage
          ? { success: false, error: failMessage }
          : { success: true, messageId: data.data[i]?.id };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown email error";
      for (let i = 0; i < chunk.length; i++) {
        results[start + i] = { success: false, error: msg };
      }
    }
  }

  return results;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> {
  // In development, intercept all outgoing email and redirect to the dev address.
  // Set DEV_EMAIL_INTERCEPT=you@example.com in .env.local to enable.
  const intercept = process.env.DEV_EMAIL_INTERCEPT;
  const to = intercept ?? options.to;
  const subject = intercept
    ? `[DEV → ${options.to}] ${options.subject}`
    : options.subject;

  try {
    const { data, error } = await resend.emails.send({
      from: await resolveFromAddress(),
      to,
      subject,
      html: await wrapEmailBody(options.html, undefined, options.manageUrl),
      replyTo: options.replyTo,
      attachments: options.attachments,
    });

    if (error) {
      console.error("Email send error:", error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown email error";
    console.error("Email send exception:", msg);
    return { success: false, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────
// Application email templates (minimal HTML for v1)
// ─────────────────────────────────────────────────────────────────

export async function verificationEmail(
  applicantName: string,
  verificationUrl: string
): Promise<{ subject: string; html: string }> {
  const identity = await getPlatformIdentity();
  return {
    subject: `Verify your application — ${identity.clientName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Verify Your Application</h2>
        <p>Hi ${applicantName},</p>
        <p>Thank you for applying to ${identity.clientName}. Please verify your email address to continue:</p>
        <p style="margin: 24px 0;">
          <a href="${verificationUrl}"
             style="background-color: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Verify Email Address
          </a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">
          If you didn't submit this application, you can safely ignore this email.
        </p>
      </div>
    `,
  };
}

export async function applicationReceivedEmail(
  applicantName: string,
  applicationType: "member" | "partner"
): Promise<{ subject: string; html: string }> {
  const identity = await getPlatformIdentity();
  const typeLabel = applicationType === "member" ? "Membership" : "Partnership";
  return {
    subject: `${typeLabel} Application Received — ${identity.clientName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${typeLabel} Application Received</h2>
        <p>Hi ${applicantName},</p>
        <p>Your ${typeLabel.toLowerCase()} application has been received and is under review.
           We'll be in touch once our team has reviewed your application.</p>
        <p>If you have questions, reply to this email${identity.supportEmail ? ` or contact us at
           <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>` : ""}.</p>
      </div>
    `,
  };
}

export async function adminNewApplicationEmail(
  applicantName: string,
  orgName: string,
  applicationType: "member" | "partner",
  adminUrl: string
): Promise<{ subject: string; html: string }> {
  const typeLabel = applicationType === "member" ? "Membership" : "Partnership";
  return {
    subject: `New ${typeLabel} Application: ${orgName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>New ${typeLabel} Application</h2>
        <p><strong>${applicantName}</strong> has submitted a ${typeLabel.toLowerCase()} application for <strong>${orgName}</strong>.</p>
        <p style="margin: 24px 0;">
          <a href="${adminUrl}"
             style="background-color: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Review Application
          </a>
        </p>
      </div>
    `,
  };
}

export async function applicationApprovedEmail(
  applicantName: string,
  applicationType: "member" | "partner",
  paymentUrl: string
): Promise<{ subject: string; html: string }> {
  const identity = await getPlatformIdentity();
  const typeLabel = applicationType === "member" ? "Membership" : "Partnership";
  return {
    subject: `${typeLabel} Application Approved — ${identity.clientName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your Application Has Been Approved!</h2>
        <p>Hi ${applicantName},</p>
        <p>Great news — your ${typeLabel.toLowerCase()} application to ${identity.clientName} has been approved.</p>
        <p>To complete your setup, please submit your payment:</p>
        <p style="margin: 24px 0;">
          <a href="${paymentUrl}"
             style="background-color: #16a34a; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Complete Payment
          </a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">
          After payment, you'll be invited to set up your account and complete onboarding.
        </p>
      </div>
    `,
  };
}

export async function applicationRejectedEmail(
  applicantName: string,
  applicationType: "member" | "partner",
  reason: string
): Promise<{ subject: string; html: string }> {
  const identity = await getPlatformIdentity();
  const typeLabel = applicationType === "member" ? "Membership" : "Partnership";
  return {
    subject: `${typeLabel} Application Update — ${identity.clientName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${typeLabel} Application Update</h2>
        <p>Hi ${applicantName},</p>
        <p>Thank you for your interest in ${identity.clientName}. After reviewing your application,
           we're unable to approve it at this time.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
        <p>If you have questions or would like to discuss this further, please contact us${identity.supportEmail ? ` at
           <a href="mailto:${identity.supportEmail}">${identity.supportEmail}</a>` : ""}.</p>
      </div>
    `,
  };
}

export async function accountInviteEmail(
  applicantName: string,
  inviteUrl: string
): Promise<{ subject: string; html: string }> {
  const identity = await getPlatformIdentity();
  return {
    subject: `Set Up Your Account — ${identity.clientName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to ${identity.clientName}</h2>
        <p>Hi ${applicantName},</p>
        <p>Your account has been created. Click below to set your password and get started:</p>
        <p style="margin: 24px 0;">
          <a href="${inviteUrl}"
             style="background-color: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Set Up Your Account
          </a>
        </p>
      </div>
    `,
  };
}

/**
 * Terminal email for a pay-first booth applicant (paid for a booth +
 * partnership before an org/account existed — see prospective-booth-checkout.ts
 * and approveApplication). Replaces accountInviteEmail for this case so
 * there's exactly one email confirming "you're paid, click here to log in
 * and start onboarding" instead of a generic invite plus a separate (and
 * incorrect) payment request.
 */
export function paidBoothWelcomeEmail(
  applicantName: string,
  inviteUrl: string,
  boothLabel: string | null,
  conferenceLabel: string | null
): { subject: string; html: string } {
  const purchase = [boothLabel, conferenceLabel].filter(Boolean).join(" at ");
  return {
    subject: "You're all set — Campus Stores Canada",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Campus Stores Canada</h2>
        <p>Hi ${applicantName},</p>
        <p>Your partnership application has been approved, and your payment${purchase ? ` for ${purchase}` : ""} is already on file — there's nothing more to pay.</p>
        <p>Click below to set your password and get started:</p>
        <p style="margin: 24px 0;">
          <a href="${inviteUrl}"
             style="background-color: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Set Up Your Account
          </a>
        </p>
      </div>
    `,
  };
}

// ─────────────────────────────────────────────────────────────────
// Second-signer / content approval email templates
// ─────────────────────────────────────────────────────────────────

interface ContentChangeQueuedOptions {
  to: string;
  entityDisplayName: string;
  fieldLabel: string;
  previousValue: string | null;
  proposedValue: string | null;
  reviewUrl: string | null;
  superAdminOnly: boolean;
  expiresAt: Date;
}

export async function sendContentChangeQueued(opts: ContentChangeQueuedOptions): Promise<void> {
  const expiryStr = opts.expiresAt.toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  });

  const approverNote = opts.superAdminOnly
    ? `<p style="margin:0 0 16px;padding:10px 14px;background:#FEF3C7;border-left:3px solid #F59E0B;border-radius:4px;font-size:13px;color:#92400E;">
         This field requires <strong>super admin</strong> approval.
       </p>`
    : "";

  const reviewButton = opts.reviewUrl
    ? `<p style="margin:24px 0 8px;">
         <a href="${opts.reviewUrl}"
            style="background-color:#163D6D;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
           Review Change in Context
         </a>
       </p>
       <p style="margin:0;font-size:12px;color:#6B7280;">
         This link takes you directly to the page where the change would appear.
       </p>`
    : `<p style="color:#6B7280;font-size:13px;">Review this change in the admin panel.</p>`;

  const html = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#163D6D;">Content Change Awaiting Approval</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;">A change has been submitted and needs your approval before it goes live.</p>
    ${approverNote}
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;width:35%;">Page / Entity</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;">${opts.entityDisplayName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Field</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;">${opts.fieldLabel}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Current value</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#6B7280;">${opts.previousValue ?? "—"}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Proposed value</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;font-weight:600;">${opts.proposedValue ?? "—"}</td>
      </tr>
    </table>
    ${reviewButton}
    <p style="margin:24px 0 0;font-size:12px;color:#9CA3AF;">
      This request expires ${expiryStr} ET. If not actioned, it will be automatically discarded.
    </p>
  `;

  await sendEmail({ to: opts.to, subject: `Content change awaiting approval — ${opts.fieldLabel} on ${opts.entityDisplayName}`, html });
}

interface ContentChangeApprovedOptions {
  to: string;
  entityDisplayName: string;
  fieldLabel: string;
  approvedValue: string | null;
  pageHref: string | null;
}

export async function sendContentChangeApproved(opts: ContentChangeApprovedOptions): Promise<void> {
  const pageLink = opts.pageHref
    ? `<p style="margin:20px 0 0;">
         <a href="${opts.pageHref}"
            style="background-color:#16A34A;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
           View the Page
         </a>
       </p>`
    : "";

  const html = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#163D6D;">Your Content Change Is Live</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;">Your proposed change has been approved and is now live on the site.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;width:35%;">Page / Entity</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;">${opts.entityDisplayName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Field</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;">${opts.fieldLabel}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Approved value</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;font-weight:600;">${opts.approvedValue ?? "—"}</td>
      </tr>
    </table>
    ${pageLink}
  `;

  await sendEmail({ to: opts.to, subject: `Your content change is now live — ${opts.fieldLabel} on ${opts.entityDisplayName}`, html });
}

interface ContentChangeRejectedOptions {
  to: string;
  entityDisplayName: string;
  fieldLabel: string;
  proposedValue: string | null;
  rejectionNote: string | null;
  hasCounterProposal: boolean;
  pageHref: string | null;
}

export async function sendContentChangeRejected(opts: ContentChangeRejectedOptions): Promise<void> {
  const noteBlock = opts.rejectionNote
    ? `<p style="margin:0 0 16px;padding:10px 14px;background:#FEF2F2;border-left:3px solid #EF4444;border-radius:4px;font-size:13px;color:#991B1B;">
         <strong>Reviewer note:</strong> ${opts.rejectionNote}
       </p>`
    : "";

  const counterBlock = opts.hasCounterProposal
    ? `<p style="margin:0 0 16px;padding:10px 14px;background:#EFF6FF;border-left:3px solid #3B82F6;border-radius:4px;font-size:13px;color:#1E40AF;">
         The reviewer has submitted an alternative suggestion. It is now in the approval queue — you will be notified once it is actioned.
       </p>`
    : "";

  const resubmitLink = opts.pageHref
    ? `<p style="margin:20px 0 0;">
         <a href="${opts.pageHref}"
            style="background-color:#163D6D;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
           Go to Page to Resubmit
         </a>
       </p>`
    : "";

  const html = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#163D6D;">Content Change Not Approved</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;">Your proposed change was reviewed and not approved at this time.</p>
    ${noteBlock}
    ${counterBlock}
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;width:35%;">Page / Entity</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;">${opts.entityDisplayName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Field</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;">${opts.fieldLabel}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Your proposed value</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#6B7280;">${opts.proposedValue ?? "—"}</td>
      </tr>
    </table>
    ${resubmitLink}
  `;

  await sendEmail({ to: opts.to, subject: `Content change not approved — ${opts.fieldLabel} on ${opts.entityDisplayName}`, html });
}

interface ContentChangeFyiOptions {
  fieldLabel: string;
  entityDisplayName: string;
  previousValue: string | null;
  newValue: string | null;
  changedByEmail: string;
  pageHref: string | null;
}

export async function sendContentChangeFyi(opts: ContentChangeFyiOptions): Promise<void> {
  const adminClient = (await import("@/lib/supabase/admin")).createAdminClient();
  const { data: profiles } = await adminClient
    .from("profiles")
    .select("id")
    .eq("global_role", "super_admin");

  if (!profiles?.length) return;

  const userIds = profiles.map((p: { id: string }) => p.id);
  const { lookupUserEmailsByIds } = await import("@/lib/supabase/user-lookup");
  const emailMap = await lookupUserEmailsByIds(adminClient, userIds);
  const superAdminEmails = userIds.filter((id) => emailMap[id]).map((id) => emailMap[id]);

  const pageLink = opts.pageHref
    ? `<a href="${opts.pageHref}" style="color:#163D6D;">${opts.pageHref}</a>` : opts.pageHref ?? "";

  const html = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#163D6D;">FYI: Content Changed</h2>
    <p style="margin:0 0 24px;color:#6B7280;font-size:14px;">
      This is a passive notification. No action is required — this change has already gone live.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;width:35%;">Page / Entity</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;">${opts.entityDisplayName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Field</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;">${opts.fieldLabel}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Previous value</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#6B7280;">${opts.previousValue ?? "—"}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">New value</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;font-weight:600;">${opts.newValue ?? "—"}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;color:#374151;">Changed by</td>
        <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;color:#1A1A1A;">${opts.changedByEmail}</td>
      </tr>
    </table>
    ${opts.pageHref ? `<p style="margin:0;font-size:13px;color:#6B7280;">View: ${pageLink}</p>` : ""}
  `;

  for (const email of superAdminEmails) {
    await sendEmail({
      to: email,
      subject: `FYI: ${opts.fieldLabel} changed on ${opts.entityDisplayName}`,
      html,
    });
  }
}
