// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Campaign Initiatives
// The ongoing, goal-driven thing (e.g. "Onboarding for Partner Admins"),
// distinct from a MessageCampaign (one send). See lib/comms/types.ts.
// ─────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import type { AudienceDefinition, CampaignInitiativeStatus, CommsCampaign, CommsCampaignMilestone } from "./types";

export interface CampaignInitiativeWithTotals extends CommsCampaign {
  sendCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  failedCount: number;
  complainedCount: number;
  lastSentAt: string | null;
}

export async function listCampaignInitiatives(): Promise<CampaignInitiativeWithTotals[]> {
  const supabase = createAdminClient();
  const { data: campaigns, error } = await supabase
    .from("comms_campaigns")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !campaigns) {
    console.error("[comms/campaigns] listCampaignInitiatives error:", error);
    return [];
  }

  const { data: totals } = await supabase.from("comms_campaign_totals").select("*");
  const totalsById = new Map((totals ?? []).map((t) => [t.campaign_id, t]));

  return campaigns.map((c) => {
    const t = totalsById.get(c.id);
    return {
      ...(c as CommsCampaign),
      sendCount: t?.send_count ?? 0,
      deliveredCount: t?.delivered_count ?? 0,
      openedCount: t?.opened_count ?? 0,
      clickedCount: t?.clicked_count ?? 0,
      failedCount: t?.failed_count ?? 0,
      complainedCount: t?.complained_count ?? 0,
      lastSentAt: t?.last_sent_at ?? null,
    };
  });
}

export async function getCampaignInitiative(id: string): Promise<CampaignInitiativeWithTotals | null> {
  const supabase = createAdminClient();
  const [{ data: campaign, error }, { data: t }] = await Promise.all([
    supabase.from("comms_campaigns").select("*").eq("id", id).single(),
    supabase.from("comms_campaign_totals").select("*").eq("campaign_id", id).maybeSingle(),
  ]);

  if (error || !campaign) return null;

  return {
    ...(campaign as CommsCampaign),
    sendCount: t?.send_count ?? 0,
    deliveredCount: t?.delivered_count ?? 0,
    openedCount: t?.opened_count ?? 0,
    clickedCount: t?.clicked_count ?? 0,
    failedCount: t?.failed_count ?? 0,
    complainedCount: t?.complained_count ?? 0,
    lastSentAt: t?.last_sent_at ?? null,
  };
}

export async function createCampaignInitiative(data: {
  name: string;
  goal?: string;
  createdBy?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("comms_campaigns")
    .insert({ name: data.name, goal: data.goal || null, created_by: data.createdBy ?? null })
    .select("id")
    .single();

  if (error || !row) return { success: false, error: error?.message ?? "Insert failed" };
  return { success: true, id: row.id };
}

export async function updateCampaignInitiative(
  id: string,
  patch: {
    name?: string;
    goal?: string | null;
    status?: CampaignInitiativeStatus;
    target_condition_keys?: string[];
    target_condition_match?: "all" | "any";
  }
): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("comms_campaigns").update(patch).eq("id", id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Only allowed when the campaign has never sent anything — cascades to
 * delete every forked email in its roster (message_templates.campaign_id
 * ON DELETE CASCADE) and its milestones. Once there's send history, use
 * status "ended" instead so that history stays attached and visible.
 */
export async function deleteCampaignInitiative(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from("message_campaigns")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", id);

  if (count && count > 0) {
    return { success: false, error: "Can't delete a campaign that has sends — set it to \"ended\" instead." };
  }

  const { error } = await supabase.from("comms_campaigns").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Merge a campaign's ongoing relevance conditions into an audience
 * definition, at resolve time — not when the send was created. Called
 * right before resolveAudience/previewAudience so a scheduled send
 * re-checks who's still in scope at the moment it actually goes out,
 * not a stale snapshot from whenever it was authored.
 */
export async function resolveEffectiveAudience(
  audience: AudienceDefinition,
  campaignId?: string | null
): Promise<AudienceDefinition> {
  if (!campaignId) return audience;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("comms_campaigns")
    .select("target_condition_keys, target_condition_match")
    .eq("id", campaignId)
    .maybeSingle();

  const campaignKeys = data?.target_condition_keys ?? [];
  if (campaignKeys.length === 0) return audience;

  // Kept as a separate gate (not merged into filters.condition_keys) — see
  // AudienceDefinition.filters.campaign_condition_keys — so the campaign's
  // own ALL/ANY choice doesn't get flattened together with the send's own
  // ad-hoc segmentation choice.
  return {
    ...audience,
    filters: {
      ...audience.filters,
      campaign_condition_keys: campaignKeys,
      campaign_condition_match: (data?.target_condition_match as "all" | "any" | undefined) ?? "all",
    },
  };
}

export async function listMilestones(campaignId: string): Promise<CommsCampaignMilestone[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("comms_campaign_milestones")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("occurred_at", { ascending: false });

  if (error) {
    console.error("[comms/campaigns] listMilestones error:", error);
    return [];
  }
  return (data ?? []) as CommsCampaignMilestone[];
}

export async function createMilestone(data: {
  campaignId: string;
  templateId?: string;
  note: string;
  occurredAt?: Date;
  createdBy?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("comms_campaign_milestones")
    .insert({
      campaign_id: data.campaignId,
      template_id: data.templateId ?? null,
      note: data.note,
      occurred_at: (data.occurredAt ?? new Date()).toISOString(),
      created_by: data.createdBy ?? null,
    })
    .select("id")
    .single();

  if (error || !row) return { success: false, error: error?.message ?? "Insert failed" };
  return { success: true, id: row.id };
}
