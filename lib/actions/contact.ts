"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalAuthContext } from "@/lib/auth/guards";

export interface ContactFormData {
  subject: string;
  name: string;
  email: string;
  organization?: string;
  message: string;
  is_idn: boolean;
}

export async function submitContactInquiry(
  data: ContactFormData
): Promise<{ success: true } | { success: false; error: string }> {
  // Basic validation
  if (!data.name.trim())    return { success: false, error: "Name is required." };
  if (!data.email.trim())   return { success: false, error: "Email is required." };
  if (!data.message.trim()) return { success: false, error: "Message is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return { success: false, error: "Please enter a valid email address." };
  }

  const authCtx = await getOptionalAuthContext();
  const userId  = authCtx?.userId ?? null;

  const db = createAdminClient();
  const { error } = await db.from("contact_inquiries").insert({
    subject:      data.subject,
    name:         data.name.trim(),
    email:        data.email.trim().toLowerCase(),
    organization: data.organization?.trim() || null,
    message:      data.message.trim(),
    is_idn:       data.is_idn,
    user_id:      userId,
    status:       "new",
  });

  if (error) {
    console.error("[contact] insert failed:", error);
    return { success: false, error: "Something went wrong. Please try again." };
  }

  return { success: true };
}
