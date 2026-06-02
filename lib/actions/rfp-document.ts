"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import { sendEmail } from "@/lib/email/send";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const SIGNED_URL_TTL = 3600; // 1 hour

// ─────────────────────────────────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────────────────────────────────

export async function uploadRFPDocument({
  orgId,
  fileData,
  fileName,
  contentType,
}: {
  orgId: string;
  fileData: string;   // base64 data URL
  fileName: string;
  contentType: string;
}): Promise<{ success: boolean; storagePath?: string; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const isAdmin = auth.ctx.globalRole === "admin" || auth.ctx.globalRole === "super_admin";

  if (!isAdmin) {
    const { data: membership } = await db
      .from("user_organizations")
      .select("role")
      .eq("user_id", auth.ctx.userId)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .maybeSingle();

    if (membership?.role !== "org_admin") {
      return { success: false, error: "Not authorized" };
    }
  }

  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    return { success: false, error: "Only PDF and Word documents are accepted." };
  }

  const base64Data = fileData.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  if (buffer.length > MAX_FILE_SIZE) {
    return { success: false, error: "File exceeds 50MB limit." };
  }

  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const folder = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `rfp/${orgId}/${folder}/${sanitizedName}`;

  const { error: uploadError } = await db.storage
    .from("partner-documents")
    .upload(storagePath, buffer, { contentType, upsert: false });

  if (uploadError) {
    console.error("[rfp-document] upload error:", uploadError);
    return { success: false, error: uploadError.message };
  }

  return { success: true, storagePath };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get signed URL — enforces RFP visibility against the requesting user
// ─────────────────────────────────────────────────────────────────────────────

export async function getRFPDocumentUrl(
  rfpId: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: "Sign in to access this document." };

  const db = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rfp } = await (db as any)
    .from("rfps")
    .select("document_storage_path, visibility, status, closes_at, organization_id")
    .eq("id", rfpId)
    .maybeSingle();

  if (!rfp?.document_storage_path) {
    return { success: false, error: "Document not found." };
  }

  // Org admins of the posting org and global admins can always access
  const isAdmin = auth.ctx.globalRole === "admin" || auth.ctx.globalRole === "super_admin";
  const isOwnOrg = auth.ctx.orgAdminOrgIds.includes(rfp.organization_id);

  if (!isAdmin && !isOwnOrg) {
    // Check visibility against the requesting user's org type
    const now = new Date().toISOString();
    const isExpired = rfp.status === "closed" || rfp.closes_at < now;

    if (isExpired) {
      return { success: false, error: "This RFP has closed." };
    }

    if (rfp.visibility === "members") {
      const { data: membership } = await db
        .from("user_organizations")
        .select("organization_id, organizations(type)")
        .eq("user_id", auth.ctx.userId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orgType = (membership?.organizations as any)?.type;
      if (orgType !== "Member") {
        return { success: false, error: "This document is available to member organizations only." };
      }
    }

    if (rfp.visibility === "partners") {
      const { data: membership } = await db
        .from("user_organizations")
        .select("organization_id, organizations(type)")
        .eq("user_id", auth.ctx.userId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orgType = (membership?.organizations as any)?.type;
      if (!["Partner", "Vendor"].includes(orgType)) {
        return { success: false, error: "This document is available to partner organizations only." };
      }
    }
    // "network" and "public" just require authentication, which we've already verified
  }

  const { data: signedData, error: signError } = await db.storage
    .from("partner-documents")
    .createSignedUrl(rfp.document_storage_path, SIGNED_URL_TTL);

  if (signError || !signedData?.signedUrl) {
    console.error("[rfp-document] signed URL error:", signError);
    return { success: false, error: "Could not generate document link." };
  }

  return { success: true, url: signedData.signedUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public email gate — unauthenticated visitors provide an email address and
// receive a time-limited signed link. No account required; creates an audit trail.
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_LINK_TTL = 60 * 60 * 48; // 48 hours — generous for email delivery

export async function requestPublicRFPDocument(
  rfpId: string,
  email: string
): Promise<{ success: boolean; error?: string }> {
  // Basic email validation
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { success: false, error: "Please enter a valid email address." };
  }

  const db = createAdminClient();
  const now = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rfp } = await (db as any)
    .from("rfps")
    .select(`
      id, title, description, category, visibility, status, closes_at,
      document_storage_path,
      organization:organizations(name, slug)
    `)
    .eq("id", rfpId)
    .maybeSingle();

  if (!rfp?.document_storage_path) {
    return { success: false, error: "Document not found." };
  }

  if (rfp.visibility !== "public") {
    return { success: false, error: "This document requires a CSC account. Please sign in." };
  }

  if (rfp.status === "closed" || rfp.closes_at < now) {
    return { success: false, error: "This RFP has closed." };
  }

  const { data: signedData, error: signError } = await db.storage
    .from("partner-documents")
    .createSignedUrl(rfp.document_storage_path, EMAIL_LINK_TTL);

  if (signError || !signedData?.signedUrl) {
    console.error("[rfp-document] public sign error:", signError);
    return { success: false, error: "Could not generate document link." };
  }

  const orgName = (rfp.organization as { name: string } | null)?.name ?? "Campus Stores Canada";
  const expiryNote = "This link expires in 48 hours.";

  const { success, error: emailError } = await sendEmail({
    to: trimmed,
    subject: `RFP Document: ${rfp.title} — ${orgName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1A1A1A;">Your requested RFP document</h2>
        <p>You requested the full RFP document for:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0 24px;">
          <tr>
            <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;width:35%;">RFP</td>
            <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;">${rfp.title}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;">Posted by</td>
            <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;">${orgName}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;font-size:13px;font-weight:600;">Category</td>
            <td style="padding:8px 12px;border:1px solid #E5E7EB;font-size:13px;">${rfp.category}</td>
          </tr>
        </table>
        <p style="margin: 24px 0;">
          <a href="${signedData.signedUrl}"
             style="background-color:#EE2A2E;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
            Download Full RFP
          </a>
        </p>
        <p style="color:#6B7280;font-size:13px;">${expiryNote}</p>
        <p style="color:#6B7280;font-size:13px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });

  if (!success) {
    console.error("[rfp-document] email send failed:", emailError);
    return { success: false, error: "Could not send email. Please try again." };
  }

  return { success: true };
}
