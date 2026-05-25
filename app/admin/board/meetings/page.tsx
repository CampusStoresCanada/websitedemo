/**
 * /admin/board/meetings  — All board meetings
 */

import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, isSuperAdmin } from "@/lib/auth/guards";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import CreateMeetingButton from "@/components/admin/board/CreateMeetingButton";

export const metadata = {
  title: "Board Meetings | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TYPE_LABELS: Record<string, string> = {
  regular: "Regular",
  special:  "Special",
  agm:     "AGM",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    upcoming:  "bg-blue-100 text-blue-700",
    completed: "bg-gray-100 text-gray-500",
    cancelled: "bg-red-100 text-red-600",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

export default async function BoardMeetingsPage() {
  const auth = await requireAdmin();
  const isSA = auth.ok && isSuperAdmin(auth.ctx.globalRole);
  const db = createAdminClient();

  const { data: meetings } = await db
    .from("board_meetings")
    .select("id, title, meeting_date, meeting_type, status, notes")
    .order("meeting_date", { ascending: false });

  // Doc count per meeting
  const ids = (meetings ?? []).map((m) => m.id);
  const docCountMap: Record<string, number> = {};

  if (ids.length > 0) {
    const { data: docs } = await db
      .from("board_documents")
      .select("meeting_id")
      .in("meeting_id", ids);

    for (const doc of docs ?? []) {
      if (!doc.meeting_id) continue;
      docCountMap[doc.meeting_id] = (docCountMap[doc.meeting_id] ?? 0) + 1;
    }
  }

  const rows = meetings ?? [];

  return (
    <main>
      <AdminPageHeader
        title="Board Meetings"
        description="All board meeting records and associated documents."
        actions={
          <div className="flex items-center gap-2">
            {isSA && <CreateMeetingButton />}
            {isSA && (
              <Link
                href="/admin/board/settings"
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                title="Board settings"
              >
                ⚙️ Settings
              </Link>
            )}
            <Link
              href="/admin/board"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              ← Board Portal
            </Link>
          </div>
        }
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm text-gray-400">No meetings yet. Documents sync automatically from OneDrive.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600">Documents</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((m) => {
                const count = docCountMap[m.id] ?? 0;
                return (
                  <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{m.meeting_date}</td>
                    <td className="px-4 py-3 text-gray-600">{TYPE_LABELS[m.meeting_type] ?? m.meeting_type}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={m.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">{count}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/board/meetings/${m.id}`}
                        className="text-xs text-accent hover:underline font-medium"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </main>
  );
}
