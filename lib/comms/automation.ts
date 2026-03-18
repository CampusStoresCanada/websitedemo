// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Automation Trigger Layer
// Idempotent: same trigger_event_key = no duplicate send
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { createCampaign, executeCampaignSend } from "./send";
import type { TriggerAutomationOptions } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Trigger an automated campaign from a system event.
 *
 * - If triggerEventKey already exists in automation_runs → skip (idempotent)
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

  // Create campaign
  const createResult = await createCampaign({
    name: options.campaignName,
    templateKey: options.templateKey,
    audience: options.audience,
    variableValues: options.variableValues,
    triggerSource: options.triggerSource,
    automationMode: options.automationMode,
    triggerEventKey: options.triggerEventKey,
  });

  if (!createResult.success || !createResult.campaignId) {
    await recordRun(supabase, options, null, "failed", createResult.error);
    return { status: "failed", error: createResult.error };
  }

  const campaignId = createResult.campaignId;

  if (options.automationMode === "draft_only") {
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
