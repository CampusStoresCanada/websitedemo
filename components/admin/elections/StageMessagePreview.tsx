"use client";

/**
 * The message a single cycle step sends, previewable where that step lives.
 *
 * This used to be a separate panel listing all seven. Reading it meant holding
 * two orders in your head at once — the cycle, and a list of messages in
 * roughly the same order — and deciding which entry belonged to the step you
 * were actually looking at. The message is a property of the step, so it
 * belongs under the step.
 */

import { useState } from "react";
import Link from "next/link";
import { Eye, Pencil, AlertTriangle } from "lucide-react";
import EmailPreviewModal from "@/components/comms/EmailPreviewModal";
import type { ElectionMessage } from "@/lib/elections/messages";

export default function StageMessagePreview({
  message,
  testEmail,
}: {
  message: ElectionMessage;
  testEmail: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (message.missingTemplate) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-red-700">
        <AlertTriangle size={12} />
        No template named {message.templateKey} — this send would fail.
      </p>
    );
  }

  return (
    <div className="mt-1.5">
      <p className="truncate text-xs italic text-gray-500">“{message.renderedSubject}”</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-gray-900"
        >
          <Eye size={12} />
          Preview &amp; send a test
        </button>
        {message.templateId && (
          <Link
            href={`/admin/comms/templates/${message.templateId}`}
            className="inline-flex items-center gap-1 text-xs text-gray-500 underline decoration-gray-300 underline-offset-2 hover:text-gray-800"
          >
            <Pencil size={12} />
            Edit wording
          </Link>
        )}
        {message.note && <span className="text-xs text-gray-400">{message.note}</span>}
      </div>

      {open && (
        <EmailPreviewModal
          bodyHtml={message.bodyHtml}
          subject={message.subject}
          variableKeys={message.variableKeys}
          initialVariables={message.variables}
          isTransactional={message.isTransactional}
          defaultTestEmail={testEmail ?? ""}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
