"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import EmailPreviewModal from "./EmailPreviewModal";

interface CampaignPreviewButtonProps {
  bodyHtml: string;
  subject: string;
  variableKeys: string[];
  /** Campaign-level variable values to pre-fill in the preview */
  variableValues: Record<string, string>;
}

export default function CampaignPreviewButton({
  bodyHtml,
  subject,
  variableKeys,
  variableValues,
}: CampaignPreviewButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <Eye size={15} />
        Preview Email
      </button>

      {open && (
        <EmailPreviewModal
          bodyHtml={bodyHtml}
          subject={subject}
          variableKeys={variableKeys}
          initialVariables={variableValues}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
