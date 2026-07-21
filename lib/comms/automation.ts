// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Automation Trigger Layer
// Idempotent: same trigger_event_key = no duplicate send
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { createCampaign, executeCampaignSend } from "./send";
import type { TemplateKey, AutomationMode, TriggerAutomationOptions } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Trigger an automated campaign from a system event.
 *
 * - If triggerEventKey already exists in automation_runs → skip (idempotent)
 * - If an enabled automation_rules row exists for this trigger → its template
 *   + mode override the caller's code defaults; if the row is disabled, the
 *   trigger is skipped entirely (admin turned it off — no send, no draft)
 * - Otherwise the caller's templateKey/automationMode are used as-is
 * - If automationMode = 'draft_only' → creates campaign as draft, no send
 * - If automationMode = 'auto_send' → creates campaign and sends immediately
 */
export async function triggerAutomation(
  options: TriggerAutomationOptions
): Promise<{
  status: "sent" | "created_draft" | "skipped" | "failed";
  campaignId?: string;
  error?: string;
}> {
  const supabase = createAdminClient();

  // Idempotency check
  const { data: existing } = await supabase
    .from("message_automation_runs")
    .select("id, status, campaign_id")
    .eq("trigger_event_key", options.triggerEventKey)
    .maybeSingle();

  if (existing) {
    return { status: "skipped", campaignId: existing.campaign_id ?? undefined };
  }

  // Admin-configurable override (see automation_rules migration). Unconfigured
  // triggers (no row) fall through to the caller's code defaults unchanged.
  const ruleKey = options.ruleKey ?? options.templateKey;
  const { data: rule } = await supabase
    .from("automation_rules")
    .select("template_key, automation_mode, enabled")
    .eq("rule_key", ruleKey)
    .maybeSingle();

  if (rule && !rule.enabled) {
    await recordRun(supabase, options, null, "skipped", "Disabled via automation rule");
    return { status: "skipped" };
  }

  const templateKey = (rule?.template_key ?? options.templateKey) as TemplateKey;
  const automationMode = (rule?.automation_mode ?? options.automationMode) as AutomationMode;

  // Create campaign
  const createResult = await createCampaign({
    name: options.campaignName,
    templateKey,
    audience: options.audience,
    variableValues: options.variableValues,
    triggerSource: options.triggerSource,
    automationMode,
    triggerEventKey: options.triggerEventKey,
  });

  if (!createResult.success || !createResult.campaignId) {
    await recordRun(supabase, options, null, "failed", createResult.error);
    return { status: "failed", error: createResult.error };
  }

  const campaignId = createResult.campaignId;

  if (automationMode === "draft_only") {
    await recordRun(supabase, options, campaignId, "created_draft", null);
    return { status: "created_draft", campaignId };
  }

  // auto_send: execute immediately
  const sendResult = await executeCampaignSend(campaignId);
  const runStatus = sendResult.failedCount === sendResult.recipientCount ? "failed" : "sent";
  await recordRun(
    supabase,
    options,
    campaignId,
    runStatus,
    sendResult.errors.length ? sendResult.errors.join("; ") : null
  );

  return { status: runStatus, campaignId };
}

async function recordRun(
  supabase: AdminClient,
  options: TriggerAutomationOptions,
  campaignId: string | null,
  status: "sent" | "created_draft" | "skipped" | "failed",
  error: string | null | undefined
): Promise<void> {
  await supabase.from("message_automation_runs").insert({
    trigger_source: options.triggerSource,
    trigger_event_key: options.triggerEventKey,
    campaign_id: campaignId,
    status,
    error: error ?? null,
    processed_at: new Date().toISOString(),
  });
}
