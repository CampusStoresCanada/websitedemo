import { createAdminClient } from "@/lib/supabase/admin";
import { listTemplates } from "@/lib/comms/templates";
import { createCampaign, executeCampaignSend } from "@/lib/comms/send";
import { getCampaignInitiative } from "@/lib/comms/campaigns";
import { listConditions } from "@/lib/comms/conditions/store";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { AudienceDefinition, AudienceType } from "@/lib/comms/types";
import NewCampaignForm from "@/components/comms/NewCampaignForm";

export const metadata = {
  title: "New Campaign | Communications | Admin | Campus Stores Canada",
};

export const maxDuration = 60; // "Send Immediately" can push a few hundred recipients through sendEmailBatch

/**
 * "email,name,var1,var2" header row, then one row per recipient. Each
 * non-email/name column becomes that recipient's own {{var}} value,
 * distinct from every other recipient in the same campaign — a real
 * mail merge, not a shared body with a personalized greeting. No quoted-
 * comma support; a plain split is enough for the lists this is for.
 */
function parseMailMergeCsv(
  csv: string
): { email: string; name: string | null; variableOverrides?: Record<string, string> }[] {
  const lines = csv
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const emailIdx = headers.findIndex((h) => h.toLowerCase() === "email");
  const nameIdx = headers.findIndex((h) => h.toLowerCase() === "name");
  if (emailIdx === -1) return [];

  return lines.slice(1).flatMap((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const email = cols[emailIdx];
    if (!email) return [];
    const name = nameIdx >= 0 ? cols[nameIdx] || null : null;
    const variableOverrides: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (i === emailIdx || i === nameIdx) return;
      if (cols[i]) variableOverrides[h] = cols[i];
    });
    return [{ email, name, variableOverrides: Object.keys(variableOverrides).length ? variableOverrides : undefined }];
  });
}

async function handleCreateCampaign(formData: FormData) {
  "use server";

  const name = formData.get("name") as string;
  const templateId = (formData.get("template_id") as string) || undefined;
  const subjectOverride = (formData.get("subject") as string) || undefined;
  const bodyOverride = (formData.get("body_html") as string) || undefined;
  const audienceType = formData.get("audience_type") as AudienceType;
  const conferenceId = formData.get("conference_id") as string | null;
  const customEmails = formData.get("custom_emails") as string | null;
  const mailMergeCsv = formData.get("mail_merge_csv") as string | null;
  const entityId = (formData.get("entity_id") as string | null)?.trim() || null;
  const sendTiming = (formData.get("send_timing") as string) || "draft";
  const scheduledAtRaw = formData.get("scheduled_at") as string | null;
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : undefined;
  const campaignId = (formData.get("campaign_id") as string) || undefined;

  // Collect variable values from var_* prefixed fields
  const variableValues: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("var_") && typeof value === "string" && value) {
      variableValues[key.slice(4)] = value;
    }
  }

  const audience: AudienceDefinition = {
    type: audienceType,
    filters: {},
  };

  if (conferenceId) {
    audience.filters!.conference_instance_id = conferenceId;
  }

  if (audienceType === "custom_emails" && customEmails) {
    audience.filters!.emails = customEmails
      .split(/[\n,]/)
      .map((e) => e.trim())
      .filter(Boolean);
  }

  if (audienceType === "custom_recipient_list" && mailMergeCsv) {
    audience.filters!.recipients = parseMailMergeCsv(mailMergeCsv);
  }

  if (audienceType === "contact_tags") {
    const tags = formData.getAll("contact_tags") as string[];
    if (tags.length > 0) audience.filters!.tags = tags;
  }

  if (audienceType === "org_admins") {
    const orgType = (formData.get("org_type") as string | null)?.trim();
    if (orgType) audience.filters!.org_type = orgType;
    const roles = formData.getAll("roles") as string[];
    if (roles.length > 0) audience.filters!.roles = roles;
  }

  const entityScopedAudiences = new Set<AudienceType>([
    "conference_holders",
    "conference_orgs_with_open_seats",
    "conference_orgs_fully_assigned",
  ]);
  if (entityScopedAudiences.has(audienceType) && entityId) {
    audience.filters!.entity_id = entityId;
  }

  const conditionKeys = formData.getAll("condition_keys") as string[];
  if (conditionKeys.length > 0) {
    audience.filters!.condition_keys = conditionKeys;
    audience.filters!.condition_match = (formData.get("condition_match") as "all" | "any") || "all";
  }

  const result = await createCampaign({
    name,
    templateId,
    subjectOverride,
    bodyOverride,
    audience,
    variableValues: Object.keys(variableValues).length > 0 ? variableValues : undefined,
    triggerSource: "manual",
    scheduledAt: sendTiming === "scheduled" ? scheduledAt : undefined,
    campaignId,
  });

  if (!result.success || !result.campaignId) {
    return;
  }

  if (sendTiming === "immediate") {
    await executeCampaignSend(result.campaignId);
  }
  // "scheduled" campaigns: created with status "scheduled", fired by the
  // comms-scheduled-send cron once scheduled_at arrives.

  redirect(`/admin/comms/${result.campaignId}`);
}

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ conference_id?: string; campaign_id?: string; template_id?: string }>;
}) {
  const db = createAdminClient();
  const {
    conference_id: defaultConferenceId,
    campaign_id: campaignId,
    template_id: defaultTemplateId,
  } = await searchParams;

  const [templates, campaignInitiative, conditions] = await Promise.all([
    listTemplates(campaignId ? { campaignId } : undefined),
    campaignId ? getCampaignInitiative(campaignId) : Promise.resolve(null),
    listConditions(),
  ]);

  const { data: conferences } = await db
    .from("conference_instances")
    .select("id, name, status")
    .order("created_at", { ascending: false })
    .limit(10);

  const conferenceIds = (conferences ?? []).map((c) => c.id);
  // is_for_sale scopes this to actual purchasable/holdable catalog items —
  // excludes logistics entities (days, rooms, sessions, policies) that
  // nobody holds a seat in via entity_balance_seats, so the admin picks
  // from a short, relevant list instead of everything in the catalog.
  const { data: entities } = conferenceIds.length
    ? await db
        .from("conference_entities")
        .select("id, conference_id, name, kind")
        .in("conference_id", conferenceIds)
        .eq("is_for_sale", true)
        .order("kind")
        .order("name")
    : { data: [] };

  const entitiesByConference: Record<string, { id: string; name: string; kind: string }[]> = {};
  for (const e of entities ?? []) {
    (entitiesByConference[e.conference_id] ??= []).push({ id: e.id, name: e.name, kind: e.kind });
  }

  return (
    <main>
      <Link
        href={campaignInitiative ? `/admin/comms/campaigns/${campaignInitiative.id}` : "/admin/comms"}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        {campaignInitiative ? "← Campaign" : "← Communications"}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">New Send</h1>
      <p className="mt-1 text-sm text-gray-600">
        {campaignInitiative
          ? `Send an email from "${campaignInitiative.name}". Choose the audience, then send now or save as draft.`
          : "Create a one-off send. Choose a template and audience, then send now or save as draft."}
      </p>

      <NewCampaignForm
        action={handleCreateCampaign}
        templates={templates}
        conferences={conferences ?? []}
        entitiesByConference={entitiesByConference}
        defaultConferenceId={defaultConferenceId}
        campaignId={campaignInitiative?.id}
        campaignName={campaignInitiative?.name}
        defaultTemplateId={defaultTemplateId}
        conditions={conditions.map((c) => ({ key: c.key, label: c.label }))}
      />
    </main>
  );
}
