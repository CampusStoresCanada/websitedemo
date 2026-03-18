import { Resend } from "resend";
import { wrapEmailBody } from "./layout";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_ADDRESS = "Campus Stores Canada <noreply@campusstores.ca>";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
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
      from: FROM_ADDRESS,
      to,
      subject,
      html: wrapEmailBody(options.html),
      replyTo: options.replyTo,
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

export function verificationEmail(
  applicantName: string,
  verificationUrl: string
): { subject: string; html: string } {
  return {
    subject: "Verify your application — Campus Stores Canada",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Verify Your Application</h2>
        <p>Hi ${applicantName},</p>
        <p>Thank you for applying to Campus Stores Canada. Please verify your email address to continue:</p>
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

export function applicationReceivedEmail(
  applicantName: string,
  applicationType: "member" | "partner"
): { subject: string; html: string } {
  const typeLabel = applicationType === "member" ? "Membership" : "Partnership";
  return {
    subject: `${typeLabel} Application Received — Campus Stores Canada`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${typeLabel} Application Received</h2>
        <p>Hi ${applicantName},</p>
        <p>Your ${typeLabel.toLowerCase()} application has been received and is under review.
           We'll be in touch once our team has reviewed your application.</p>
        <p>If you have questions, reply to this email or contact us at
           <a href="mailto:info@campusstores.ca">info@campusstores.ca</a>.</p>
      </div>
    `,
  };
}

export function adminNewApplicationEmail(
  applicantName: string,
  orgName: string,
  applicationType: "member" | "partner",
  adminUrl: string
): { subject: string; html: string } {
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

export function applicationApprovedEmail(
  applicantName: string,
  applicationType: "member" | "partner",
  paymentUrl: string
): { subject: string; html: string } {
  const typeLabel = applicationType === "member" ? "Membership" : "Partnership";
  return {
    subject: `${typeLabel} Application Approved — Campus Stores Canada`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your Application Has Been Approved!</h2>
        <p>Hi ${applicantName},</p>
        <p>Great news — your ${typeLabel.toLowerCase()} application to Campus Stores Canada has been approved.</p>
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

export function applicationRejectedEmail(
  applicantName: string,
  applicationType: "member" | "partner",
  reason: string
): { subject: string; html: string } {
  const typeLabel = applicationType === "member" ? "Membership" : "Partnership";
  return {
    subject: `${typeLabel} Application Update — Campus Stores Canada`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${typeLabel} Application Update</h2>
        <p>Hi ${applicantName},</p>
        <p>Thank you for your interest in Campus Stores Canada. After reviewing your application,
           we're unable to approve it at this time.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
        <p>If you have questions or would like to discuss this further, please contact us at
           <a href="mailto:info@campusstores.ca">info@campusstores.ca</a>.</p>
      </div>
    `,
  };
}

export function accountInviteEmail(
  applicantName: string,
  inviteUrl: string
): { subject: string; html: string } {
  return {
    subject: "Set Up Your Account — Campus Stores Canada",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Campus Stores Canada</h2>
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
