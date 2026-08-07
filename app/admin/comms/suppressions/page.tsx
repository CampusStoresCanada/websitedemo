import Link from "next/link";
import { redirect } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { parseUTC } from "@/lib/utils";
import {
  listSuppressions,
  unsubscribeEmail,
  resubscribeEmail,
  GLOBAL_SUPPRESSION_CATEGORY,
} from "@/lib/comms/suppressions";
import type { TemplateCategory } from "@/lib/comms/types";

export const metadata = {
  title: "Suppressions | Communications | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ADD_CATEGORIES: { value: TemplateCategory | typeof GLOBAL_SUPPRESSION_CATEGORY; label: string }[] = [
  { value: GLOBAL_SUPPRESSION_CATEGORY, label: "All (global unsubscribe)" },
  { value: "conference", label: "Conference" },
  { value: "membership", label: "Membership" },
  { value: "events", label: "Events" },
  { value: "general", label: "General announcements" },
];

const CATEGORY_COLORS: Record<string, string> = {
  all: "bg-red-100 text-red-700",
  conference: "bg-blue-100 text-blue-700",
  membership: "bg-purple-100 text-purple-700",
  events: "bg-orange-100 text-orange-700",
  general: "bg-gray-100 text-gray-600",
};

async function addSuppressionAction(formData: FormData) {
  "use server";
  const email = (formData.get("email") as string)?.trim();
  const category = formData.get("category") as TemplateCategory | typeof GLOBAL_SUPPRESSION_CATEGORY;
  const reason = (formData.get("reason") as string)?.trim() || undefined;
  if (!email || !category) return;
  await unsubscribeEmail(email, category, reason ? `admin: ${reason}` : "admin: manually added");
  redirect("/admin/comms/suppressions");
}

async function removeSuppressionAction(formData: FormData) {
  "use server";
  const email = formData.get("email") as string;
  const category = formData.get("category") as TemplateCategory | typeof GLOBAL_SUPPRESSION_CATEGORY;
  if (!email || !category) return;
  await resubscribeEmail(email, category);
  redirect("/admin/comms/suppressions");
}

export default async function SuppressionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const rows = await listSuppressions({ search: q });

  return (
    <main>
      <AdminPageHeader
        title="Suppressions"
        description="Everyone who's unsubscribed from marketing emails, globally or by category. Transactional emails are never affected by this list."
        actions={
          <Link
            href="/admin/comms"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            ← Communications
          </Link>
        }
      />

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Manually suppress an email</h2>
        <p className="text-xs text-gray-500 mb-3">
          For requests that come in outside the self-serve preference page — a phone call or reply-to-sender email, for example.
        </p>
        <form action={addSuppressionAction} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              name="email"
              type="email"
              required
              placeholder="person@example.com"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
            <select
              name="category"
              defaultValue={GLOBAL_SUPPRESSION_CATEGORY}
              className="block rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            >
              {ADD_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-gray-700 mb-1">Reason (optional)</label>
            <input
              name="reason"
              placeholder="e.g. requested by phone 2026-07-30"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            Add
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Suppressed emails</h2>
            <p className="text-xs text-gray-500 mt-0.5">{rows.length} row{rows.length !== 1 ? "s" : ""} shown, most recent first.</p>
          </div>
          <form className="flex items-center gap-2">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search email…"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
            />
            <button
              type="submit"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Search
            </button>
            {q && (
              <Link href="/admin/comms/suppressions" className="text-xs text-gray-500 hover:text-gray-700">
                Clear
              </Link>
            )}
          </form>
        </div>

        {!rows.length ? (
          <div className="px-4 py-12 text-center text-sm text-gray-500">
            {q ? `No suppressions matching "${q}".` : "No suppressions yet."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Category</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Reason</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Added</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">{row.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        CATEGORY_COLORS[row.category] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {row.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{row.reason ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {parseUTC(row.created_at).toLocaleString("en-CA")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <form action={removeSuppressionAction}>
                      <input type="hidden" name="email" value={row.email} />
                      <input type="hidden" name="category" value={row.category} />
                      <button
                        type="submit"
                        className="text-xs font-medium text-accent hover:text-accent-hover"
                      >
                        Resubscribe
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
