"use server";

import { requireAuthenticated } from "@/lib/auth/guards";

interface SubmitFlagParams {
  pageUrl: string;
  priority: "normal" | "high";
  note?: string;
  elementSelector?: string;
  elementContent?: string;
}

interface SubmitFlagResult {
  success: boolean;
  error?: string;
  flagId?: string;
}

/**
 * Submit a flag for any page on the site.
 * Used by the global Toolkit Flag feature.
 */
export async function submitFlag({
  pageUrl,
  priority,
  note,
  elementSelector,
  elementContent,
}: SubmitFlagParams): Promise<SubmitFlagResult> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok || !auth.ctx.userEmail) {
      return { success: false, error: "You must be logged in to submit a flag" };
    }
    const { supabase, userId, userEmail } = auth.ctx;

    // Get user profile for name
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();

    // Try to extract organization ID from URL if it's an org profile page
    let organizationId: string | null = null;
    const orgMatch = pageUrl.match(/\/org\/([^\/]+)/);
    if (orgMatch) {
      const slug = orgMatch[1];
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", slug)
        .single();
      if (org) {
        organizationId = org.id;
      }
    }

    // Insert the flag
    const { data: flag, error: insertError } = await supabase
      .from("flags")
      .insert({
        flagger_id: userId,
        flagger_email: userEmail,
        flagger_name: profile?.display_name || null,
        page_url: pageUrl,
        organization_id: organizationId,
        priority,
        note: note?.trim() || null,
        element_selector: elementSelector || null,
        element_content: elementContent?.slice(0, 500) || null,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Error inserting flag:", insertError);
      return { success: false, error: "Failed to submit flag" };
    }

    // Log for debugging
    console.log("=== FLAG SUBMITTED ===");
    console.log("Flag ID:", flag.id);
    console.log("Page:", pageUrl);
    console.log("Organization ID:", organizationId || "(none)");
    console.log("Priority:", priority);
    console.log("Note:", note || "(none)");
    console.log("User:", profile?.display_name || userEmail);
    console.log("======================");

    return { success: true, flagId: flag.id };
  } catch (err) {
    console.error("Error submitting flag:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
