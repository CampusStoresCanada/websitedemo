"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "comms-content";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Images embedded in comms emails — publicly hosted, since Resend/recipients' mail clients fetch them directly, not through the app. */
export async function uploadCommsImage(
  formData: FormData,
): Promise<{ url: string } | { error: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { error: "Not authorized" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided" };
  if (!ALLOWED.includes(file.type)) return { error: "Only JPEG, PNG, WebP, and GIF are allowed" };
  if (file.size > MAX_BYTES) return { error: "File must be under 5 MB" };

  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${auth.ctx.userId}/${Date.now()}.${ext}`;

  const db = createAdminClient();
  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    console.error("[upload-comms-image]", error);
    return { error: "Upload failed" };
  }

  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}
