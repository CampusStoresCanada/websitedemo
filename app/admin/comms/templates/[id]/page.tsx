import { createAdminClient } from "@/lib/supabase/admin";
import { updateTemplate } from "@/lib/comms/templates";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { MessageTemplate } from "@/lib/comms/types";
import TemplateBodyEditor from "@/components/comms/TemplateBodyEditor";
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

  await updateTemplate(id, { name, description, subject, body_html });
  redirect("/admin/comms/templates");
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
        <Link href="/admin/comms/templates" className="text-sm text-[#EE2A2E] hover:underline mt-2 block">
          ← Back to Templates
        </Link>
      </main>
    );
  }

  const t = template as MessageTemplate;

  return (
    <main>
      <Link href="/admin/comms/templates" className="text-sm text-gray-500 hover:text-gray-700">
        ← Templates
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">Edit Template</h1>
      <p className="mt-1 text-sm text-gray-500">
        Key: <code className="bg-gray-100 rounded px-1.5 py-0.5 text-xs">{t.key}</code>
        {t.is_system && (
          <span className="ml-2 text-xs text-amber-600">
            System template — cannot be deleted
          </span>
        )}
      </p>

      <form action={handleUpdate} className="mt-6 space-y-5 max-w-3xl">
        <input type="hidden" name="id" value={t.id} />

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

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Subject
          </label>
          <p className="text-xs text-gray-500 mb-1">
            Available variables:{" "}
            {t.variable_keys.map((v) => (
              <code key={v} className="mr-1 bg-blue-50 rounded px-1 text-[#D92327] text-xs">
                {`{{${v}}}`}
              </code>
            ))}
          </p>
          <input
            name="subject"
            defaultValue={t.subject}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Body</label>
          <p className="text-xs text-gray-500 mb-1">
            Use <code className="bg-gray-100 rounded px-1 text-xs">{`{{variable_name}}`}</code> tokens for substitution — they will be replaced when the email is sent.
          </p>
          <TemplateBodyEditor initialHtml={t.body_html} fieldName="body_html" />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="rounded-lg bg-[#EE2A2E] px-5 py-2 text-sm font-medium text-white hover:bg-[#D92327] transition-colors"
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
