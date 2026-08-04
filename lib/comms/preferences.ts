// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Public Preference-Center Resolution
// Turns a delivery id (the token in a manageUrl link) into just enough
// to render /email-preferences/[deliveryId] — nothing else about the
// recipient is exposed to that unauthenticated route.
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import type { TemplateCategory } from "./types";

export interface DeliveryPreferencesInfo {
  email: string;
  displayName: string | null;
  /** The category of the email that generated this link, if any — used only to pre-explain why the recipient landed here. */
  originatingCategory: TemplateCategory | null;
}

export async function resolveDeliveryForPreferences(
  deliveryId: string
): Promise<DeliveryPreferencesInfo | null> {
  const supabase = createAdminClient();

  const { data: delivery } = await supabase
    .from("message_deliveries")
    .select("recipient_id, campaign_id")
    .eq("id", deliveryId)
    .single();
  if (!delivery) return null;

  const { data: recipient } = await supabase
    .from("message_recipients")
    .select("contact_email, display_name")
    .eq("id", delivery.recipient_id)
    .single();
  if (!recipient) return null;

  let originatingCategory: TemplateCategory | null = null;
  const { data: campaign } = await supabase
    .from("message_campaigns")
    .select("template_id")
    .eq("id", delivery.campaign_id)
    .single();
  if (campaign?.template_id) {
    const { data: template } = await supabase
      .from("message_templates")
      .select("category")
      .eq("id", campaign.template_id)
      .single();
    originatingCategory = (template?.category as TemplateCategory | undefined) ?? null;
  }

  return {
    email: recipient.contact_email,
    displayName: recipient.display_name,
    originatingCategory,
  };
}
