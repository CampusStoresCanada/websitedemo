"use client";

import { parseUTC } from "@/lib/utils";
import type { WaitlistRow } from "@/lib/events/types";

interface WaitlistTableProps {
  waitlist: WaitlistRow[];
}

export default function WaitlistTable({ waitlist }: WaitlistTableProps) {
  if (waitlist.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">No one on the waitlist.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3 text-left font-medium w-12">#</th>
            <th className="px-4 py-3 text-left font-medium">Name</th>
            <th className="px-4 py-3 text-left font-medium">Email</th>
            <th className="px-4 py-3 text-left font-medium">Joined</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {waitlist.map((entry) => (
            <tr key={entry.waitlist_id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 text-gray-400 font-mono">{entry.position}</td>
              <td className="px-4 py-3 font-medium text-gray-900">
                {entry.display_name ?? <span className="text-gray-400 italic">Unknown</span>}
              </td>
              <td className="px-4 py-3 text-gray-500">{entry.email ?? "—"}</td>
              <td className="px-4 py-3 text-gray-500">
                {parseUTC(entry.joined_at).toLocaleDateString("en-CA")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
