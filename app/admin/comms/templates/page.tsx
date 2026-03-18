import { listTemplates } from "@/lib/comms/templates";
import Link from "next/link";
import type { TemplateCategory } from "@/lib/comms/types";

export const metadata = {
  title: "Email Templates | Communications | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<TemplateCategory | string, string> = {
  renewal: "Renewal",
  user_mgmt: "User Management",
  conference: "Conference",
  membership: "Membership",
  general: "General",
};

export default async function TemplatesPage() {
  const templates = await listTemplates();

  const byCategory = templates.reduce<Record<string, typeof templates>>(
    (acc, t) => {
      const key = t.category;
      if (!acc[key]) acc[key] = [];
      acc[key].push(t);
      return acc;
    },
    {}
  );

  const categoryOrder: string[] = [
    "renewal",
    "user_mgmt",
    "conference",
    "membership",
    "general",
  ];

  return (
    <main>
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/admin/comms"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Communications
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Email Templates</h1>
          <p className="mt-1 text-sm text-gray-600">
            System templates can be edited but not deleted. Custom templates can be added.
          </p>
        </div>
        <Link
          href="/admin/comms/templates/new"
          className="rounded-lg bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#D92327] transition-colors whitespace-nowrap"
        >
          New Template
        </Link>
      </div>

      <div className="mt-6 space-y-8">
        {categoryOrder
          .filter((cat) => byCategory[cat]?.length)
          .map((category) => (
            <section key={category}>
              <h2 className="text-base font-semibold text-gray-800 mb-3">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Template</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Key</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">Variables</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600">System</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-600"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {byCategory[category].map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{t.name}</div>
                          {t.description && (
                            <div className="text-xs text-gray-500 mt-0.5">{t.description}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <code className="text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-700">
                            {t.key}
                          </code>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {t.variable_keys.map((v) => (
                              <span
                                key={v}
                                className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-xs text-[#D92327]"
                              >
                                {`{{${v}}}`}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {t.is_system ? (
                            <span className="text-xs text-gray-400">system</span>
                          ) : (
                            <span className="text-xs text-green-600">custom</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <TemplateEditButton templateId={t.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
      </div>
    </main>
  );
}

function TemplateEditButton({ templateId }: { templateId: string }) {
  return (
    <Link
      href={`/admin/comms/templates/${templateId}`}
      className="text-xs text-[#EE2A2E] hover:underline"
    >
      Edit
    </Link>
  );
}
