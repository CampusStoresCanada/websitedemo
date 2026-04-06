// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Campaign Send Orchestration
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { resolveAudience } from "./audience";
import { getTemplate, renderTemplateContent } from "./templates";
import type {
  AudienceDefinition,
  MessageCampaign,
  ResolvedRecipient,
  TemplateKey,
} from "./types";

const FROM_ADDRESS = "Campus Stores Canada <noreply@campusstores.ca>";

// ── Transactional send (no campaign record) ───────────────────────

/**
 * Send a single transactional email using a template key.
 * Used by automation triggers (renewal, user mgmt, conference actions).
 * Does NOT create a campaign record — use triggerAutomation for tracked sends.
 */
export async function sendTransactional(options: {
  templateKey: TemplateKey;
  to: string;
  recipientName?: string;
  variables: Record<string, string | number | boolean | null | undefined>;
}): Promise<{ success: boolean; error?: string }> {
  const template = await getTemplate(options.templateKey);
  if (!template) {
    return { success: false, error: `Template '${options.templateKey}' not found` };
  }

  const { subject, bodyHtml } = renderTemplateContent(template, options.variables);
  return sendEmail({ to: options.to, subject, html: bodyHtml });
}

// ── Campaign send ─────────────────────────────────────────────────

export interface ExecuteSendResult {
  campaignId: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  errors: string[];
}

/**
 * Execute a campaign send. Resolves audience, persists recipients + deliveries,
 * sends each email, and marks campaign completed/failed.
 */
export async function executeCampaignSend(
  campaignId: string,
  options: { dryRun?: boolean } = {}
): Promise<ExecuteSendResult> {
  const supabase = createAdminClient();

  // Load campaign
  const { data: campaign, error: loadErr } = await supabase
    .from("message_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (loadErr || !campaign) {
    return {
      campaignId,
      recipientCount: 0,
      sentCount: 0,
      failedCount: 0,
      errors: [loadErr?.message ?? "Campaign not found"],
    };
  }

  // Mark as sending
  if (!options.dryRun) {
    await supabase
      .from("message_campaigns")
      .update({ status: "sending", sent_at: new Date().toISOString() })
      .eq("id", campaignId);
  }

  // Resolve audience
  const recipients = await resolveAudience(
    campaign.audience_definition as unknown as AudienceDefinition
  );

  if (options.dryRun) {
    return {
      campaignId,
      recipientCount: recipients.length,
      sentCount: 0,
      failedCount: 0,
      errors: [],
    };
  }

  // Persist recipients
  const recipientRows = recipients.map((r) => ({
    campaign_id: campaignId,
    user_id: r.userId,
    contact_email: r.email,
    display_name: r.name,
    variable_overrides: r.variableOverrides ?? {},
  }));

  const { data: insertedRecipients, error: recipientErr } = await supabase
    .from("message_recipients")
    .insert(recipientRows)
    .select("id, contact_email, display_name, variable_overrides");

  if (recipientErr || !insertedRecipients) {
    await supabase
      .from("message_campaigns")
      .update({ status: "failed" })
      .eq("id", campaignId);
    return {
      campaignId,
      recipientCount: recipients.length,
      sentCount: 0,
      failedCount: recipients.length,
      errors: [recipientErr?.message ?? "Failed to insert recipients"],
    };
  }

  // Load template
  const template = campaign.template_id
    ? await getTemplate(campaign.template_id as TemplateKey)
    : null;

  let sentCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const recipient of insertedRecipients) {
    const variables: Record<string, string> = {
      ...(campaign.variable_values as Record<string, string>),
      ...(recipient.variable_overrides as Record<string, string>),
    };

    const subjectRaw =
      campaign.subject_override ?? template?.subject ?? "(no subject)";
    const bodyRaw =
      campaign.body_override ?? template?.body_html ?? "";

    const { subject, bodyHtml } = template
      ? renderTemplateContent(
          { ...template, subject: subjectRaw, body_html: bodyRaw },
          variables
        )
      : {
          subject: subjectRaw,
          bodyHtml: bodyRaw,
        };

    // Insert delivery record
    const { data: delivery, error: delInsertErr } = await supabase
      .from("message_deliveries")
      .insert({
        campaign_id: campaignId,
        recipient_id: recipient.id,
        status: "queued",
      })
      .select("id")
      .single();

    if (delInsertErr || !delivery) {
      failedCount++;
      errors.push(`Recipient ${recipient.contact_email}: delivery insert failed`);
      continue;
    }

    const result = await sendEmail({
      to: recipient.contact_email,
      subject,
      html: bodyHtml,
    });

    if (result.success) {
      await supabase
        .from("message_deliveries")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: result.messageId ?? null,
        })
        .eq("id", delivery.id);
      sentCount++;
    } else {
      await supabase
        .from("message_deliveries")
        .update({
          status: "failed",
          error: result.error,
          failed_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      failedCount++;
      errors.push(`Recipient ${recipient.contact_email}: ${result.error}`);
    }
  }

  // Mark campaign completed/failed
  const finalStatus = failedCount === insertedRecipients.length ? "failed" : "completed";
  await supabase
    .from("message_campaigns")
    .update({ status: finalStatus, completed_at: new Date().toISOString() })
    .eq("id", campaignId);

  return {
    campaignId,
    recipientCount: recipients.length,
    sentCount,
    failedCount,
    errors,
  };
}

// ── Campaign creation helpers ─────────────────────────────────────

export async function createCampaign(options: {
  name: string;
  templateKey?: TemplateKey;
  subjectOverride?: string;
  bodyOverride?: string;
  audience: AudienceDefinition;
  variableValues?: Record<string, string>;
  triggerSource?: MessageCampaign["trigger_source"];
  automationMode?: MessageCampaign["automation_mode"];
  triggerEventKey?: string;
  scheduledAt?: Date;
  createdBy?: string;
}): Promise<{ success: boolean; campaignId?: string; error?: string }> {
  const supabase = createAdminClient();

  let templateId: string | null = null;
  if (options.templateKey) {
    const template = await getTemplate(options.templateKey);
    templateId = template?.id ?? null;
  }

  const { data, error } = await supabase
    .from("message_campaigns")
    .insert({
      name: options.name,
      template_id: templateId,
      subject_override: options.subjectOverride || null,
      body_override: options.bodyOverride || null,
      audience_definition: options.audience as unknown as import("@/lib/database.types").Json,
      variable_values: (options.variableValues ?? {}) as unknown as import("@/lib/database.types").Json,
      trigger_source: options.triggerSource ?? "manual",
      automation_mode: options.automationMode ?? null,
      trigger_event_key: options.triggerEventKey ?? null,
      scheduled_at: options.scheduledAt?.toISOString() ?? null,
      created_by: options.createdBy ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  return { success: true, campaignId: data.id };
}
