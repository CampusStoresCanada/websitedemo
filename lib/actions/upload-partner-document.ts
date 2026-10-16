"use server";

import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
// ⚠️ A "use server" module may only export async functions, so the shared
// constants live in lib/partner-links.ts. Only `next build` catches this.
import { MAX_PARTNER_DOCUMENT_BYTES } from "@/lib/partner-links";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

interface CreateUploadUrlParams {
  orgId: string;
  fileName: string;
  contentType: string;
  /** Declared by the browser, used only for the friendly error. The bucket
   *  enforces the real ceiling regardless of what's claimed here. */
  fileSize: number;
}

interface CreateUploadUrlResult {
  success: boolean;
  /** Storage path to record on the partner_links entry once the upload lands. */
  path?: string;
  /** Single-use upload token, scoped to `path` by Supabase Storage. */
  token?: string;
  error?: string;
}

/**
 * Authorize an upload and hand back a signed, single-use URL the browser
 * writes to directly.
 *
 * ⛔ The bytes must not travel through this Server Action. The previous version
 * took the whole file as a base64 data URL argument, which put it inside the
 * action's request body — and a Server Action body is capped
 * (`serverActions.bodySizeLimit`, 6mb in next.config.ts). Base64 inflates a
 * file by about a third, so the real ceiling was roughly 4MB against a UI
 * promising 50MB, and the code's own 50MB check could never fire: the request
 * was refused before the action ever ran. It shows up as no server log at all,
 * which is why nothing appeared in production logs while people watched
 * uploads fail. The largest file that ever made it into this bucket was 3.0MB.
 *
 * Authorization still happens here — who may upload, where it lands, and what
 * type it is are all decided server-side. Only the transfer moves.
 */
export async function createPartnerDocumentUploadUrl({
  orgId,
  fileName,
  contentType,
  fileSize,
}: CreateUploadUrlParams): Promise<CreateUploadUrlResult> {
  const auth = await requireOrgAdminOrSuperAdmin(orgId);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    return {
      success: false,
      error: `File type not allowed: ${contentType || "unknown"}. Accepted: PDF, Word, Excel.`,
    };
  }

  if (fileSize > MAX_PARTNER_DOCUMENT_BYTES) {
    const mb = (fileSize / 1024 / 1024).toFixed(1);
    return { success: false, error: `That file is ${mb}MB — the limit is 50MB.` };
  }

  const sanitizedOrgId = orgId.replace(/[^a-zA-Z0-9-]/g, "");
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const storagePath = `${sanitizedOrgId}/${Date.now()}_${sanitizedName}`;

  const { data, error } = await createAdminClient()
    .storage.from("partner-documents")
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error("[upload-partner-document] signed url failed", error);
    return { success: false, error: error?.message ?? "Could not start the upload." };
  }

  return { success: true, path: data.path, token: data.token };
}
