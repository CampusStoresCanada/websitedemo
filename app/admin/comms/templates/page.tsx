import { listTemplates } from "@/lib/comms/templates";
import Link from "next/link";
import { groupTemplatesByCategory } from "@/lib/comms/template-categories";

export const metadata = {
  title: "Email Templates | Communications | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  // Shared-library templates only — campaign-scoped forks belong to their
  // campaign's own page, not here. See listTemplates.
  const templates = await listTemplates();

  // Derived from the categories present in the data, never from a fixed
  // list: a newly added category gets its own heading rather than having
  // its rows silently dropped. See lib/comms/template-categories.
  const groups = groupTemplatesByCategory(templates);

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
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors whitespace-nowrap"
        >
          New Template
        </Link>
      </div>

      <div className="mt-6 space-y-8">
        {groups.map(({ category, label, templates: inCategory }) => (
            <section key={category}>
              <h2 className="text-base font-semibold text-gray-800 mb-3">
                {label}
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
                    {inCategory.map((t) => (
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
                                className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-xs text-accent"
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
      className="text-xs text-accent hover:underline"
    >
      Edit
    </Link>
  );
}
