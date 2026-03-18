import { createAdminClient } from "@/lib/supabase/admin";
import { listTemplates } from "@/lib/comms/templates";
import { createCampaign, executeCampaignSend } from "@/lib/comms/send";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { AudienceDefinition, AudienceType } from "@/lib/comms/types";
import NewCampaignForm from "@/components/comms/NewCampaignForm";

export const metadata = {
  title: "New Campaign | Communications | Admin | Campus Stores Canada",
};

async function handleCreateCampaign(formData: FormData) {
  "use server";

  const name = formData.get("name") as string;
  const templateKey = (formData.get("template_key") as string) || undefined;
  const subjectOverride = (formData.get("subject") as string) || undefined;
  const bodyOverride = (formData.get("body_html") as string) || undefined;
  const audienceType = formData.get("audience_type") as AudienceType;
  const conferenceId = formData.get("conference_id") as string | null;
  const customEmails = formData.get("custom_emails") as string | null;
  const sendTiming = (formData.get("send_timing") as string) || "draft";
  const scheduledAtRaw = formData.get("scheduled_at") as string | null;
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : undefined;

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

  const result = await createCampaign({
    name,
    templateKey: templateKey as Parameters<typeof createCampaign>[0]["templateKey"],
    subjectOverride,
    bodyOverride,
    audience,
    variableValues: Object.keys(variableValues).length > 0 ? variableValues : undefined,
    triggerSource: "manual",
    scheduledAt: sendTiming === "scheduled" ? scheduledAt : undefined,
  });

  if (!result.success || !result.campaignId) {
    return;
  }

  if (sendTiming === "immediate") {
    await executeCampaignSend(result.campaignId);
  }
  // "scheduled" campaigns: stored with scheduled_at, fired by the scheduler (v1.4)

  redirect(`/admin/comms/${result.campaignId}`);
}

export default async function NewCampaignPage() {
  const db = createAdminClient();
  const templates = await listTemplates();

  const { data: conferences } = await db
    .from("conference_instances")
    .select("id, name, status")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <main>
      <Link href="/admin/comms" className="text-sm text-gray-500 hover:text-gray-700">
        ← Communications
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">New Campaign</h1>
      <p className="mt-1 text-sm text-gray-600">
        Create a targeted email campaign. Choose a template and audience, then send now or save as draft.
      </p>

      <NewCampaignForm
        action={handleCreateCampaign}
        templates={templates}
        conferences={conferences ?? []}
      />
    </main>
  );
}
