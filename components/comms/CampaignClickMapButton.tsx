"use client";

import { useState } from "react";
import { Flame } from "lucide-react";
import ClickMapModal from "./ClickMapModal";

interface CampaignClickMapButtonProps {
  bodyHtml: string;
  subject: string;
  variableKeys: string[];
  variableValues: Record<string, string>;
  /** Click count per exact link URL, aggregated from message_link_clicks. */
  clicksByUrl: Record<string, number>;
  totalClicks: number;
  isTransactional?: boolean;
}

export default function CampaignClickMapButton({
  bodyHtml,
  subject,
  variableKeys,
  variableValues,
  clicksByUrl,
  totalClicks,
  isTransactional = false,
}: CampaignClickMapButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <Flame size={15} />
        Click Map
      </button>

      {open && (
        <ClickMapModal
          bodyHtml={bodyHtml}
          subject={subject}
          variableKeys={variableKeys}
          variableValues={variableValues}
          clicksByUrl={clicksByUrl}
          totalClicks={totalClicks}
          isTransactional={isTransactional}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
