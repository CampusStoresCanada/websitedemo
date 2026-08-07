import { createTemplate } from "@/lib/comms/templates";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { TemplateCategory } from "@/lib/comms/types";
import type { ContentBlock } from "@/lib/comms/blocks/types";
import TemplateVariablesAndBody from "@/components/comms/TemplateVariablesAndBody";
import PreviewEmailButton from "@/components/comms/PreviewEmailButton";

export const metadata = {
  title: "New Template | Communications | Admin | Campus Stores Canada",
};

const CATEGORY_LABELS: { value: TemplateCategory; label: string }[] = [
  { value: "general",    label: "General" },
  { value: "membership", label: "Membership" },
  { value: "renewal",    label: "Renewal" },
  { value: "conference", label: "Conference" },
  { value: "user_mgmt",  label: "User Management" },
];

async function handleCreate(formData: FormData) {
  "use server";

  const name        = formData.get("name") as string;
  const description = (formData.get("description") as string) || undefined;
  const category    = formData.get("category") as TemplateCategory;
  const subject     = formData.get("subject") as string;
  const body_html   = formData.get("body_html") as string;
  const campaignId  = (formData.get("campaign_id") as string) || undefined;
  const blocksJson  = formData.get("body_blocks_json") as string | null;
  const bodyBlocks  = blocksJson ? (JSON.parse(blocksJson) as ContentBlock[]) : undefined;
  const isTransactional = formData.get("is_transactional") === "on";

  const result = await createTemplate({ name, description, category, subject, body_html, campaignId, bodyBlocks, isTransactional });

  if (!result.success || !result.id) {
    // TODO: surface error properly
    return;
  }

  redirect(`/admin/comms/templates/${result.id}`);
}

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ campaign_id?: string }>;
}) {
  const { campaign_id: campaignId } = await searchParams;
  const backHref = campaignId ? `/admin/comms/campaigns/${campaignId}` : "/admin/comms/templates";

  return (
    <main>
      <Link href={backHref} className="text-sm text-gray-500 hover:text-gray-700">
        {campaignId ? "← Campaign" : "← Templates"}
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">
        {campaignId ? "New Email for This Campaign" : "New Template"}
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        {campaignId
          ? "This email belongs to this campaign only — editing it later won't affect the shared template library."
          : "Custom templates can be used in campaigns and are not managed by the system."}
      </p>

      <form action={handleCreate} className="mt-6 space-y-5 max-w-3xl">
        {campaignId && <input type="hidden" name="campaign_id" value={campaignId} />}

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Name <span className="text-accent">*</span>
          </label>
          <input
            name="name"
            required
            placeholder="e.g. Newsletter — Spring 2026"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Category</label>
            <select
              name="category"
              defaultValue="general"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            >
              {CATEGORY_LABELS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <input
              name="description"
              placeholder="Short summary of what this template is for"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            />
          </div>
        </div>

        <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox"
            name="is_transactional"
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
            Subject <span className="text-accent">*</span>
          </label>
          <input
            name="subject"
            required
            placeholder="Email subject line — supports {{variables}}"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
        </div>

        <TemplateVariablesAndBody initialVariableKeys={[]} initialBodyHtml="" initialBlocks={null} defaultMode="visual" />

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Create Template
          </button>
          <PreviewEmailButton variableKeys={[]} />
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
