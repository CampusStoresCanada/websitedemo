import { createTemplate } from "@/lib/comms/templates";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { TemplateCategory } from "@/lib/comms/types";
import TemplateBodyEditor from "@/components/comms/TemplateBodyEditor";
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

  const key         = (formData.get("key") as string).trim().toLowerCase().replace(/\s+/g, "_");
  const name        = formData.get("name") as string;
  const description = (formData.get("description") as string) || undefined;
  const category    = formData.get("category") as TemplateCategory;
  const subject     = formData.get("subject") as string;
  const body_html   = formData.get("body_html") as string;
  const rawVars     = formData.get("variable_keys") as string;
  const variable_keys = rawVars
    ? rawVars.split(",").map((v) => v.trim()).filter(Boolean)
    : [];

  const result = await createTemplate({ key, name, description, category, subject, body_html, variable_keys });

  if (!result.success || !result.id) {
    // TODO: surface error properly
    return;
  }

  redirect(`/admin/comms/templates/${result.id}`);
}

export default function NewTemplatePage() {
  return (
    <main>
      <Link href="/admin/comms/templates" className="text-sm text-gray-500 hover:text-gray-700">
        ← Templates
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">New Template</h1>
      <p className="mt-1 text-sm text-gray-600">
        Custom templates can be used in campaigns and are not managed by the system.
      </p>

      <form action={handleCreate} className="mt-6 space-y-5 max-w-3xl">

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Name <span className="text-[#EE2A2E]">*</span>
            </label>
            <input
              name="name"
              required
              placeholder="e.g. Newsletter — Spring 2026"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Key <span className="text-[#EE2A2E]">*</span>
            </label>
            <p className="text-xs text-gray-500 mb-1">Unique slug — lowercase, underscores only.</p>
            <input
              name="key"
              required
              pattern="[a-z][a-z0-9_]*"
              placeholder="e.g. newsletter_spring_2026"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            />
          </div>
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

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Variable Keys
          </label>
          <p className="text-xs text-gray-500 mb-1">
            Comma-separated. Use these as{" "}
            <code className="bg-gray-100 rounded px-1">{`{{variable_name}}`}</code>{" "}
            tokens in subject and body. e.g.{" "}
            <code className="text-xs text-[#D92327]">first_name, org_name, conference_year</code>
          </p>
          <input
            name="variable_keys"
            placeholder="first_name, org_name, conference_year"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Subject <span className="text-[#EE2A2E]">*</span>
          </label>
          <input
            name="subject"
            required
            placeholder="Email subject line — supports {{variables}}"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Body</label>
          <p className="text-xs text-gray-500 mb-1">
            Use{" "}
            <code className="bg-gray-100 rounded px-1 text-xs">{`{{variable_name}}`}</code>{" "}
            tokens — replaced when the email is sent.
          </p>
          <TemplateBodyEditor initialHtml="" fieldName="body_html" />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="rounded-lg bg-[#EE2A2E] px-5 py-2 text-sm font-medium text-white hover:bg-[#D92327] transition-colors"
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
