// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Campaign Send Orchestration
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, sendEmailBatch } from "@/lib/email/send";
import { resolveAudience } from "./audience";
import { resolveEffectiveAudience } from "./campaigns";
import { getTemplate, getTemplateById, renderTemplateContent, renderConditionalBlocks, renderTemplate } from "./templates";
import { extractConditionKeys, getConditionsByKeys } from "./conditions/store";
import { evaluateConditionsForRecipient } from "./conditions/evaluate";
import { filterSuppressedRecipients } from "./suppressions";
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

  const { subject, bodyHtml } = renderTemplateContent(template, {
    app_url: process.env.NEXT_PUBLIC_APP_URL ?? "",
    ...options.variables,
  });
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

  // Load template up front — needed both for rendering and for its
  // category/is_transactional, which decide whether unsubscribe
  // suppression applies to this send at all.
  const template = campaign.template_id ? await getTemplateById(campaign.template_id) : null;

  // Resolve audience — re-checks the parent campaign's ongoing relevance
  // conditions right now, not whatever they were when this send was created.
  const effectiveAudience = await resolveEffectiveAudience(
    campaign.audience_definition as unknown as AudienceDefinition,
    campaign.campaign_id
  );
  let recipients = await resolveAudience(effectiveAudience);

  // CASL: transactional templates are exempt and always go through;
  // everything else respects per-category and global unsubscribes.
  if (!template?.is_transactional) {
    recipients = await filterSuppressedRecipients(supabase, recipients, template?.category ?? null);
  }

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
    .select("id, user_id, contact_email, display_name, variable_overrides");

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

  const subjectRaw = campaign.subject_override ?? template?.subject ?? "(no subject)";
  const bodyRaw = campaign.body_override ?? template?.body_html ?? "";

  // Any {{#if key}} blocks reference a saved condition — same for every
  // recipient of this send, so resolved once, not once per recipient.
  const conditionKeys = [...extractConditionKeys(subjectRaw), ...extractConditionKeys(bodyRaw)];
  const conditions = await getConditionsByKeys(conditionKeys);

  // Render each recipient's subject/body up front. Condition evaluation
  // is per-recipient I/O, so this is no longer synchronous.
  const rendered = await Promise.all(
    insertedRecipients.map(async (recipient) => {
      const variables: Record<string, string> = {
        // Base value every send gets, regardless of audience type — lets
        // an admin build a CTA link like {{app_url}}/org/{{organization_slug}}
        // in any template, not just code-generated ones.
        app_url: process.env.NEXT_PUBLIC_APP_URL ?? "",
        ...(campaign.variable_values as Record<string, string>),
        ...(recipient.variable_overrides as Record<string, string>),
      };

      const flags = conditions.length
        ? await evaluateConditionsForRecipient(supabase, conditions, {
            userId: recipient.user_id,
            email: recipient.contact_email,
          })
        : {};

      const { subject, bodyHtml } = template
        ? renderTemplateContent(
            { ...template, subject: subjectRaw, body_html: bodyRaw },
            variables,
            flags
          )
        : {
            subject: renderTemplate(renderConditionalBlocks(subjectRaw, flags), variables),
            bodyHtml: renderTemplate(renderConditionalBlocks(bodyRaw, flags), variables),
          };

      return { recipient, subject, bodyHtml };
    })
  );

  // Bulk-insert queued delivery rows for every recipient, then batch-send
  // (chunks of up to 100 per Resend API call, not one call per recipient —
  // see sendEmailBatch) and reconcile results back onto them.
  const { data: insertedDeliveries, error: deliveryInsertErr } = await supabase
    .from("message_deliveries")
    .insert(
      rendered.map((r) => ({
        campaign_id: campaignId,
        recipient_id: r.recipient.id,
        status: "queued" as const,
      }))
    )
    .select("id, recipient_id");

  if (deliveryInsertErr || !insertedDeliveries) {
    await supabase
      .from("message_campaigns")
      .update({ status: "failed" })
      .eq("id", campaignId);
    return {
      campaignId,
      recipientCount: recipients.length,
      sentCount: 0,
      failedCount: insertedRecipients.length,
      errors: [deliveryInsertErr?.message ?? "Failed to insert deliveries"],
    };
  }

  const deliveryIdByRecipientId = new Map(
    insertedDeliveries.map((d) => [d.recipient_id, d.id])
  );

  // CASL: every commercial send needs a working unsubscribe/preferences
  // link, scoped to this specific delivery so opting out doesn't require
  // an account or login. Transactional templates skip it — see wrapEmailBody.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const sendResults = await sendEmailBatch(
    rendered.map((r) => {
      const deliveryId = deliveryIdByRecipientId.get(r.recipient.id);
      return {
        to: r.recipient.contact_email,
        subject: r.subject,
        html: r.bodyHtml,
        manageUrl:
          !template?.is_transactional && deliveryId
            ? `${appUrl}/email-preferences/${deliveryId}`
            : undefined,
      };
    })
  );

  let sentCount = 0;
  let failedCount = 0;
  const errors: string[] = [];
  const sentAt = new Date().toISOString();

  await Promise.all(
    rendered.map(async (r, i) => {
      const deliveryId = deliveryIdByRecipientId.get(r.recipient.id);
      const result = sendResults[i];

      if (!deliveryId) {
        failedCount++;
        errors.push(`Recipient ${r.recipient.contact_email}: delivery record missing`);
        return;
      }

      if (result.success) {
        await supabase
          .from("message_deliveries")
          .update({
            status: "sent",
            sent_at: sentAt,
            provider_message_id: result.messageId ?? null,
          })
          .eq("id", deliveryId);
        sentCount++;
      } else {
        await supabase
          .from("message_deliveries")
          .update({
            status: "failed",
            error: result.error,
            failed_at: sentAt,
          })
          .eq("id", deliveryId);
        failedCount++;
        errors.push(`Recipient ${r.recipient.contact_email}: ${result.error}`);
      }
    })
  );

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
  /** Direct template id — takes priority over templateKey. Used when picking from a campaign's own roster, whose forked templates aren't in the TemplateKey union. */
  templateId?: string;
  subjectOverride?: string;
  bodyOverride?: string;
  audience: AudienceDefinition;
  variableValues?: Record<string, string>;
  triggerSource?: MessageCampaign["trigger_source"];
  automationMode?: MessageCampaign["automation_mode"];
  triggerEventKey?: string;
  scheduledAt?: Date;
  createdBy?: string;
  /** The campaign initiative this send belongs to, if any. */
  campaignId?: string;
}): Promise<{ success: boolean; campaignId?: string; error?: string }> {
  const supabase = createAdminClient();

  let templateId: string | null = options.templateId ?? null;
  if (!templateId && options.templateKey) {
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
      status: options.scheduledAt ? "scheduled" : "draft",
      created_by: options.createdBy ?? null,
      campaign_id: options.campaignId ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  return { success: true, campaignId: data.id };
}

/**
 * Revert a scheduled campaign to draft — clears scheduled_at so the
 * dispatcher stops considering it. No-ops (safely) on any other status.
 */
export async function cancelScheduledCampaign(
  campaignId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("message_campaigns")
    .update({ status: "draft", scheduled_at: null })
    .eq("id", campaignId)
    .eq("status", "scheduled");

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ── Scheduled dispatch (cron) ──────────────────────────────────────

export interface DispatchScheduledResult {
  dueCount: number;
  results: ExecuteSendResult[];
}

/**
 * Find campaigns whose scheduled_at has arrived and send them. Called by
 * the comms-scheduled-send cron route. executeCampaignSend flips a
 * campaign's status to "sending" as the first thing it does, so a
 * campaign picked up here can't be picked up again by an overlapping run.
 */
export async function dispatchScheduledCampaigns(): Promise<DispatchScheduledResult> {
  const supabase = createAdminClient();

  const { data: due, error } = await supabase
    .from("message_campaigns")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(10);

  if (error || !due || due.length === 0) {
    return { dueCount: 0, results: [] };
  }

  const results: ExecuteSendResult[] = [];
  for (const campaign of due) {
    results.push(await executeCampaignSend(campaign.id));
  }

  return { dueCount: due.length, results };
}
