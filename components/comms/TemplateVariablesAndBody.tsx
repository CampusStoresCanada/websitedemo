"use client";

import TemplateEditorModeSwitch from "./TemplateEditorModeSwitch";
import type { ContentBlock } from "@/lib/comms/blocks/types";

interface TemplateVariablesAndBodyProps {
  /**
   * The template's custom variable keys as of the last save — the server
   * derives this straight from whatever {{tokens}} appear in the subject
   * and body (see extractCustomVariableKeys), so there's nothing to
   * declare here. Only used to seed the "Custom" section of the Insert
   * Variable picker; a brand-new key typed in this editing session shows
   * up there after the next save, not before.
   */
  initialVariableKeys: string[];
  initialBodyHtml: string;
  initialBlocks: ContentBlock[] | null;
  defaultMode: "visual" | "raw";
}

export default function TemplateVariablesAndBody({
  initialVariableKeys,
  initialBodyHtml,
  initialBlocks,
  defaultMode,
}: TemplateVariablesAndBodyProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">Body</label>
      <p className="text-xs text-gray-500 mb-1">
        Use the <span className="font-mono">{"{ }"}</span> button in the toolbar to insert a variable — or just type{" "}
        <code className="bg-gray-100 rounded px-1">{`{{your_key}}`}</code> directly. Any token that isn&apos;t an
        auto-filled system variable becomes something you fill in when sending — no need to declare it separately.
      </p>
      <TemplateEditorModeSwitch
        initialBodyHtml={initialBodyHtml}
        initialBlocks={initialBlocks}
        defaultMode={defaultMode}
        customVariableKeys={initialVariableKeys}
      />
    </div>
  );
}
