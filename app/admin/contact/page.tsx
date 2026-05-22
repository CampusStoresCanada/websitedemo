import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contact Inquiries | Admin",
};

function fmtDate(iso: string) {
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(utc).toLocaleString("en-CA", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  new:         "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  resolved:    "bg-gray-100 text-gray-500",
};

const SUBJECT_LABELS: Record<string, string> = {
  general:              "General",
  membership:           "Membership",
  events:               "Events",
  benchmarking:         "Benchmarking",
  partnership:          "Partnership",
  "independence-defense": "IDN",
  other:                "Other",
};

export default async function AdminContactPage() {
  await requireAdmin();

  const db = createAdminClient();

  const { data: inquiries } = await db
    .from("contact_inquiries")
    .select("*")
    .order("created_at", { ascending: false });

  const rows = inquiries ?? [];
  const newCount = rows.filter((r) => r.status === "new").length;
  const idnCount = rows.filter((r) => r.is_idn).length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Contact Inquiries"
        description={`${rows.length} total · ${newCount} new · ${idnCount} IDN`}
      />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-12 text-center text-gray-400">
          No inquiries yet.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">From</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Subject</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Preview</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Received</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} className={`hover:bg-gray-50 transition-colors ${row.is_idn ? "bg-red-50/40" : ""}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{row.name}</p>
                    <a href={`mailto:${row.email}`} className="text-xs text-gray-500 hover:underline">{row.email}</a>
                    {row.organization && (
                      <p className="text-xs text-gray-400">{row.organization}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        {SUBJECT_LABELS[row.subject] ?? row.subject}
                      </span>
                      {row.is_idn && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                          IDN
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="text-gray-600 text-xs line-clamp-2">{row.message}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {fmtDate(row.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[row.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {row.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        IDN rows are highlighted. Reply directly via email — no in-app reply yet.
        Status updates coming when volume warrants.
      </p>
    </div>
  );
}
