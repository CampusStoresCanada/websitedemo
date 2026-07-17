"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

interface UploadConferenceDocumentParams {
  conferenceId: string;
  fileData: string; // base64 data URL
  fileName: string;
  contentType: string;
}

interface UploadConferenceDocumentResult {
  success: boolean;
  storagePath?: string;
  error?: string;
}

export async function uploadConferenceDocument({
  conferenceId,
  fileData,
  fileName,
  contentType,
}: UploadConferenceDocumentParams): Promise<UploadConferenceDocumentResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    return {
      success: false,
      error: `File type not allowed: ${contentType}. Accepted: PDF, Word, Excel.`,
    };
  }

  const base64Data = fileData.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  if (buffer.length > MAX_FILE_SIZE) {
    return { success: false, error: "File exceeds 50MB limit" };
  }

  const sanitizedConferenceId = conferenceId.replace(/[^a-zA-Z0-9-]/g, "");
  const sanitizedName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100);
  const timestamp = Date.now();
  const storagePath = `${sanitizedConferenceId}/${timestamp}_${sanitizedName}`;

  const adminClient = createAdminClient();

  const { error: uploadError } = await adminClient.storage
    .from("conference-documents")
    .upload(storagePath, buffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    console.error("[upload-conference-document] upload error", uploadError);
    return { success: false, error: uploadError.message };
  }

  return { success: true, storagePath };
}
