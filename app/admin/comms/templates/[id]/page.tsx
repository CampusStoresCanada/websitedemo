import { createAdminClient } from "@/lib/supabase/admin";
import { updateTemplate } from "@/lib/comms/templates";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { MessageTemplate } from "@/lib/comms/types";
import type { ContentBlock } from "@/lib/comms/blocks/types";
import TemplateVariablesAndBody from "@/components/comms/TemplateVariablesAndBody";
import PreviewEmailButton from "@/components/comms/PreviewEmailButton";

export const metadata = {
  title: "Edit Template | Communications | Admin | Campus Stores Canada",
};

async function handleUpdate(formData: FormData) {
  "use server";
  const id = formData.get("id") as string;
  const subject = formData.get("subject") as string;
  const body_html = formData.get("body_html") as string;
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const campaignId = (formData.get("campaign_id") as string) || null;
  const blocksJson = formData.get("body_blocks_json") as string | null;
  const bodyBlocks = blocksJson ? (JSON.parse(blocksJson) as ContentBlock[]) : undefined;
  const is_transactional = formData.get("is_transactional") === "on";

  await updateTemplate(id, { name, description, subject, body_html, bodyBlocks, is_transactional });
  redirect(campaignId ? `/admin/comms/campaigns/${campaignId}` : "/admin/comms/templates");
}

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = createAdminClient();

  const { data: template, error } = await db
    .from("message_templates")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !template) {
    return (
      <main>
        <p className="text-sm text-red-600">Template not found.</p>
        <Link href="/admin/comms/templates" className="text-sm text-accent hover:underline mt-2 block">
          ← Back to Templates
        </Link>
      </main>
    );
  }

  const t = template as MessageTemplate;
  const backHref = t.campaign_id ? `/admin/comms/campaigns/${t.campaign_id}` : "/admin/comms/templates";

  return (
    <main>
      <Link href={backHref} className="text-sm text-gray-500 hover:text-gray-700">
        {t.campaign_id ? "← Campaign" : "← Templates"}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">Edit {t.campaign_id ? "Email" : "Template"}</h1>
      <p className="mt-1 text-sm text-gray-500">
        Key: <code className="bg-gray-100 rounded px-1.5 py-0.5 text-xs">{t.key}</code>
        {t.is_system && (
          <span className="ml-2 text-xs text-amber-600">
            System template — cannot be deleted
          </span>
        )}
        {t.campaign_id && (
          <span className="ml-2 text-xs text-blue-600">
            Campaign email — editing only affects this campaign
          </span>
        )}
      </p>

      <form action={handleUpdate} className="mt-6 space-y-5 max-w-3xl">
        <input type="hidden" name="id" value={t.id} />
        {t.campaign_id && <input type="hidden" name="campaign_id" value={t.campaign_id} />}

        <div>
          <label className="block text-sm font-medium text-gray-700">Name</label>
          <input
            name="name"
            defaultValue={t.name}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Description</label>
          <input
            name="description"
            defaultValue={t.description ?? ""}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            name="is_transactional"
            defaultChecked={t.is_transactional}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
          />
          <span>
            <span className="block text-sm font-medium text-gray-900">Transactional / operational</span>
            <span className="block text-xs text-gray-500">
              Confirmations, receipts, and account notices the recipient needs regardless of marketing
              preferences. These skip the unsubscribe link and are never suppressed. Leave unchecked for
              newsletters, promotions, and other marketing content.
            </span>
          </span>
        </label>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Subject
          </label>
          <input
            name="subject"
            defaultValue={t.subject}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <TemplateVariablesAndBody
          initialVariableKeys={t.variable_keys}
          initialBodyHtml={t.body_html}
          initialBlocks={t.body_blocks}
          defaultMode={t.body_blocks ? "visual" : "raw"}
        />

        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Save Template
          </button>
          <PreviewEmailButton variableKeys={t.variable_keys} />
          <Link
            href="/admin/comms/templates"
            className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
