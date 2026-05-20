"use server";

import { requireAuthenticated } from "@/lib/auth/guards";
import { sendFlagNotification } from "@/lib/circle/flag-notify";

interface SubmitFlagParams {
  pageUrl: string;
  priority: "normal" | "high";
  note?: string;
  elementSelector?: string;
  elementContent?: string;
  /** Explicit org ID from data-org-id — bypasses URL-based detection when provided */
  organizationId?: string;
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
  organizationId: explicitOrgId,
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

    // Prefer explicit org ID from data-org-id; fall back to URL parsing
    let organizationId: string | null = explicitOrgId ?? null;
    if (!organizationId) {
      const orgMatch = pageUrl.match(/\/org\/([^\/]+)/);
      if (orgMatch) {
        const slug = orgMatch[1];
        const { data: org } = await supabase
          .from("organizations")
          .select("id")
          .eq("slug", slug)
          .single();
        if (org) organizationId = org.id;
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
      return { success: false, error: `Failed to submit flag: [${insertError.code}] ${insertError.message}` };
    }

    // Fire-and-forget bot notification — don't block the response
    sendFlagNotification({
      flagId: flag.id,
      pageUrl,
      elementContent: elementContent ?? null,
      priority,
      organizationId,
      reporterName: profile?.display_name ?? null,
    }).then(({ method }) => {
      console.log(`[flag] Flag ${flag.id} notification sent via ${method ?? "none"}`);
    }).catch((err) => {
      console.error("[flag] Notification failed:", err);
    });

    return { success: true, flagId: flag.id };
  } catch (err) {
    console.error("Error submitting flag:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
