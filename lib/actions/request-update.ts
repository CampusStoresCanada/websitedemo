"use server";

import { createClient } from "@/lib/supabase/server";

interface RequestUpdateParams {
  organizationId: string;
  organizationName: string;
  requesterEmail: string;
  requesterName?: string;
  message: string;
}

export async function requestProfileUpdate({
  organizationId,
  organizationName,
  requesterEmail,
  requesterName,
  message,
}: RequestUpdateParams): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();

    // Get org admins for this organization
    const { data: orgAdmins, error: orgAdminsError } = await supabase
      .from("user_organizations")
      .select(`
        user_id,
        profiles!user_organizations_user_id_fkey (
          email,
          display_name
        )
      `)
      .eq("organization_id", organizationId)
      .eq("role", "org_admin")
      .eq("status", "active");

    if (orgAdminsError) {
      console.error("Error fetching org admins:", orgAdminsError);
    }

    // Get super admins (just IDs - we'll need to look up emails separately)
    const { data: superAdmins, error: superAdminsError } = await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("global_role", "super_admin");

    if (superAdminsError) {
      console.error("Error fetching super admins:", superAdminsError);
    }

    // Collect all recipient emails
    // Note: Email lookup from auth.users requires service role key
    // For now, we log the request and recipient IDs - actual email sending is TODO
    const recipientIds: string[] = [];

    // Add org admin IDs
    if (orgAdmins) {
      for (const admin of orgAdmins) {
        if (admin.user_id) {
          recipientIds.push(admin.user_id);
        }
      }
    }

    // Add super admin IDs
    if (superAdmins) {
      for (const admin of superAdmins) {
        if (admin.id && !recipientIds.includes(admin.id)) {
          recipientIds.push(admin.id);
        }
      }
    }

    // For now, use placeholder recipients array
    const recipients: string[] = [];

    // Log the request
    console.log("=== PROFILE UPDATE REQUEST ===");
    console.log("Organization:", organizationName);
    console.log("Organization ID:", organizationId);
    console.log("Requester:", requesterName || requesterEmail);
    console.log("Requester Email:", requesterEmail);
    console.log("Message:", message);
    console.log("Recipient User IDs:", recipientIds);
    console.log("==============================");

    // Send email if Resend API key is configured
    // Note: Resend integration is TODO - for now just log the request
    if (process.env.RESEND_API_KEY && recipients.length > 0) {
      console.log("[TODO] Would send email to:", recipients);
      console.log("[TODO] Email subject:", `Profile Update Request: ${organizationName}`);
      // Resend integration will be added when the package is installed
    }

    return { success: true };
  } catch (err) {
    console.error("Error processing update request:", err);
    return { success: false, error: "Failed to submit request" };
  }
}
