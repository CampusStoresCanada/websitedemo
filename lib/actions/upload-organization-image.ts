"use server";

import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";

interface UploadOrganizationImageParams {
  organizationId: string;
  imageType: "hero_image" | "logo" | "logo_horizontal" | "product_overlay";
  fileData: string; // Base64 encoded file data
  fileName: string;
  contentType: string;
}

interface UploadOrganizationImageResult {
  success: boolean;
  url?: string;
  error?: string;
}

export async function uploadOrganizationImage({
  organizationId,
  imageType,
  fileData,
  fileName,
  contentType,
}: UploadOrganizationImageParams): Promise<UploadOrganizationImageResult> {
  const auth = await requireOrgAdminOrSuperAdmin(organizationId);
  if (!auth.ok) return { success: false, error: auth.error };
  const supabase = auth.ctx.supabase;

  // Validate content type
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
  if (!allowedTypes.includes(contentType)) {
    return { success: false, error: `Invalid file type: ${contentType}. Allowed: ${allowedTypes.join(", ")}` };
  }

  // Convert base64 to buffer
  const base64Data = fileData.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  // Check file size (10MB max)
  if (buffer.length > 10 * 1024 * 1024) {
    return { success: false, error: "File size exceeds 10MB limit" };
  }

  // Generate unique file path
  const fileExtension = fileName.split(".").pop() || "jpg";
  const timestamp = Date.now();
  const sanitizedOrgId = organizationId.replace(/[^a-zA-Z0-9-]/g, "");
  const filePath = `${sanitizedOrgId}/${imageType}_${timestamp}.${fileExtension}`;

  // Upload to Supabase Storage
  const { error: uploadError } = await supabase.storage
    .from("organization-images")
    .upload(filePath, buffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    console.error("Error uploading image:", uploadError);
    return { success: false, error: uploadError.message };
  }

  // Get the public URL
  const { data: urlData } = supabase.storage
    .from("organization-images")
    .getPublicUrl(filePath);

  const publicUrl = urlData.publicUrl;

  // Map image type to database column
  const columnMap: Record<string, string> = {
    hero_image: "hero_image_url",
    logo: "logo_url",
    logo_horizontal: "logo_horizontal_url",
    product_overlay: "product_overlay_url",
  };

  const column = columnMap[imageType];
  if (!column) {
    return { success: false, error: `Invalid image type: ${imageType}` };
  }

  // Update the organization with the new image URL
  const { error: updateError } = await supabase
    .from("organizations")
    .update({ [column]: publicUrl })
    .eq("id", organizationId);

  if (updateError) {
    console.error("Error updating organization:", updateError);
    // Try to clean up the uploaded file
    await supabase.storage.from("organization-images").remove([filePath]);
    return { success: false, error: updateError.message };
  }

  return { success: true, url: publicUrl };
}
