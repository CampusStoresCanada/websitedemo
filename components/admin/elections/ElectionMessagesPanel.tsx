"use client";

/**
 * The messages this cycle sends, previewable and testable before they go out.
 *
 * Reuses EmailPreviewModal — the same one the campaign and template screens
 * use, which already renders the branded wrapper, lets you vary the values,
 * and sends a test to an address you type. What this adds is the values: each
 * message arrives pre-filled with THIS election's real seats, dates and links,
 * resolved by the same code that addresses the real send.
 */

import { useState } from "react";
import Link from "next/link";
import { Eye, Pencil, AlertTriangle } from "lucide-react";
import EmailPreviewModal from "@/components/comms/EmailPreviewModal";
import type { ElectionMessage } from "@/lib/elections/messages";

export default function ElectionMessagesPanel({
  messages,
  testEmail,
}: {
  messages: ElectionMessage[];
  /** The signed-in admin, offered as the default test recipient. */
  testEmail: string | null;
}) {
  const [open, setOpen] = useState<ElectionMessage | null>(null);

  return (
    <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">What members receive</h2>
      <p className="mt-1 text-xs text-gray-500">
        Every message this cycle sends, filled in with its real dates and links. Preview one to
        see exactly what lands in an inbox, or send yourself a test before it goes to anybody.
        Editing changes the wording for this and every future cycle.
      </p>

      <ul className="mt-4 divide-y divide-gray-100">
        {messages.map((m) => (
          <li key={m.key} className="flex flex-wrap items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-sm font-medium text-gray-900">{m.label}</p>
                <span className="text-xs text-gray-500">{m.stage}</span>
              </div>

              {m.missingTemplate ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-red-700">
                  <AlertTriangle size={13} />
                  No template named {m.templateKey} — this send would fail.
                </p>
              ) : (
                <p className="mt-0.5 truncate text-xs text-gray-600">{m.renderedSubject}</p>
              )}

              <p className="mt-0.5 text-xs text-gray-500">
                {m.recipientCount === 0
                  ? "Nobody eligible right now"
                  : `${m.recipientCount} recipient${m.recipientCount === 1 ? "" : "s"} as things stand`}
                {m.note ? ` · ${m.note}` : ""}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={m.missingTemplate}
                onClick={() => setOpen(m)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Eye size={13} />
                Preview &amp; test
              </button>
              {m.templateId && (
                <Link
                  href={`/admin/comms/templates/${m.templateId}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Pencil size={13} />
                  Edit wording
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      {open && (
        <EmailPreviewModal
          bodyHtml={open.bodyHtml}
          subject={open.subject}
          variableKeys={open.variableKeys}
          initialVariables={open.variables}
          isTransactional={open.isTransactional}
          defaultTestEmail={testEmail ?? ""}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
