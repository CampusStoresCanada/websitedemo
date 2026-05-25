"use server";

import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "event-content";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function uploadEditorImage(
  formData: FormData,
): Promise<{ url: string } | { error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

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
    console.error("[upload-editor-image]", error);
    return { error: "Upload failed" };
  }

  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}
