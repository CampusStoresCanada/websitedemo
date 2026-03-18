import { getConferences } from "@/lib/actions/conference";
import { CONFERENCE_STATUS_LABELS, type ConferenceStatus } from "@/lib/constants/conference";
import Link from "next/link";
import DuplicateConferenceCard from "@/components/admin/conference/DuplicateConferenceCard";

export const metadata = { title: "Conference Management | Admin" };

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    registration_open: "bg-green-100 text-green-700",
    registration_closed: "bg-yellow-100 text-yellow-700",
    scheduling: "bg-blue-100 text-[#D92327]",
    active: "bg-purple-100 text-purple-700",
    completed: "bg-gray-100 text-gray-600",
    archived: "bg-gray-50 text-gray-400",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {CONFERENCE_STATUS_LABELS[status as ConferenceStatus] ?? status}
    </span>
  );
}

export default async function ConferenceListPage() {
  const result = await getConferences();

  if (!result.success || !result.data) {
    return (
      <div className="text-center py-12 text-gray-500">
        Failed to load conferences. {result.error}
      </div>
    );
  }

  const conferences = result.data;

  return (
    <div>
      <DuplicateConferenceCard conferences={conferences} />
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Conferences</h1>
        <Link
          href="/admin/conference/create"
          className="px-4 py-2 text-sm font-medium text-white bg-[#EE2A2E] rounded-md hover:bg-[#b50001]"
        >
          Create Conference
        </Link>
      </div>

      {conferences.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <p className="text-gray-500">No conferences yet.</p>
          <Link
            href="/admin/conference/create"
            className="text-[#EE2A2E] hover:underline text-sm mt-2 inline-block"
          >
            Create your first conference
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Conference
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Year
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Dates
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {conferences.map((conf) => (
                <tr key={conf.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{conf.name}</div>
                    {conf.edition_code !== "00" && (
                      <div className="text-xs text-gray-500">Edition: {conf.edition_code}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{conf.year}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={conf.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {conf.start_date && conf.end_date
                      ? `${conf.start_date} – ${conf.end_date}`
                      : "Not set"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/conference/${conf.id}`}
                      className="text-sm text-[#EE2A2E] hover:underline"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
