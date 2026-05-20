"use server";

import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

interface UploadPartnerDocumentParams {
  orgId: string;
  fileData: string;   // base64 data URL
  fileName: string;
  contentType: string;
}

interface UploadPartnerDocumentResult {
  success: boolean;
  storagePath?: string;
  error?: string;
}

export async function uploadPartnerDocument({
  orgId,
  fileData,
  fileName,
  contentType,
}: UploadPartnerDocumentParams): Promise<UploadPartnerDocumentResult> {
  const auth = await requireOrgAdminOrSuperAdmin(orgId);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    return {
      success: false,
      error: `File type not allowed: ${contentType}. Accepted: PDF, Word, Excel.`,
    };
  }

  // Strip data URL prefix
  const base64Data = fileData.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  if (buffer.length > MAX_FILE_SIZE) {
    return { success: false, error: "File exceeds 50MB limit" };
  }

  const sanitizedOrgId = orgId.replace(/[^a-zA-Z0-9-]/g, "");
  const sanitizedName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100);
  const timestamp = Date.now();
  const storagePath = `${sanitizedOrgId}/${timestamp}_${sanitizedName}`;

  const adminClient = createAdminClient();

  const { error: uploadError } = await adminClient.storage
    .from("partner-documents")
    .upload(storagePath, buffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    console.error("[upload-partner-document] upload error", uploadError);
    return { success: false, error: uploadError.message };
  }

  return { success: true, storagePath };
}
