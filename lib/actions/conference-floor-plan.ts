"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

interface UploadFloorPlanImageParams {
  conferenceId: string;
  fileData: string; // Base64 encoded file data
  fileName: string;
  contentType: string;
}

interface UploadFloorPlanImageResult {
  success: boolean;
  url?: string;
  error?: string;
}

const ALLOWED_TYPES = ["image/svg+xml", "image/png", "image/jpeg", "image/webp"];

export async function uploadFloorPlanImage({
  conferenceId,
  fileData,
  fileName,
  contentType,
}: UploadFloorPlanImageParams): Promise<UploadFloorPlanImageResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  if (!ALLOWED_TYPES.includes(contentType)) {
    return {
      success: false,
      error: `Invalid file type: ${contentType}. Allowed: ${ALLOWED_TYPES.join(", ")}`,
    };
  }

  const base64Data = fileData.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  if (buffer.length > 10 * 1024 * 1024) {
    return { success: false, error: "File size exceeds 10MB limit" };
  }

  const db = createAdminClient();

  const fileExtension = fileName.split(".").pop() || "svg";
  const timestamp = Date.now();
  const filePath = `floor-plans/${conferenceId}/floor_plan_${timestamp}.${fileExtension}`;

  const { error: uploadError } = await db.storage
    .from("event-content")
    .upload(filePath, buffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    return { success: false, error: uploadError.message };
  }

  const { data: urlData } = db.storage.from("event-content").getPublicUrl(filePath);
  const publicUrl = urlData.publicUrl;

  const { error: updateError } = await db
    .from("conference_instances")
    .update({ floor_plan_url: publicUrl })
    .eq("id", conferenceId);

  if (updateError) {
    await db.storage.from("event-content").remove([filePath]);
    return { success: false, error: updateError.message };
  }

  return { success: true, url: publicUrl };
}
