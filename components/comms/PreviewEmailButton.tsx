"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import EmailPreviewModal from "./EmailPreviewModal";

interface PreviewEmailButtonProps {
  variableKeys: string[];
}

/**
 * Reads current subject + body_html from the template editor form DOM,
 * then opens the branded email preview modal.
 */
export default function PreviewEmailButton({ variableKeys }: PreviewEmailButtonProps) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    bodyHtml: string;
    subject: string;
  } | null>(null);

  const handleOpen = () => {
    const bodyHtml =
      (document.querySelector('textarea[name="body_html"]') as HTMLTextAreaElement)
        ?.value ?? "";
    const subject =
      (document.querySelector('input[name="subject"]') as HTMLInputElement)
        ?.value ?? "";
    setSnapshot({ bodyHtml, subject });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <Eye size={15} />
        Preview
      </button>

      {open && snapshot && (
        <EmailPreviewModal
          bodyHtml={snapshot.bodyHtml}
          subject={snapshot.subject}
          variableKeys={variableKeys}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
