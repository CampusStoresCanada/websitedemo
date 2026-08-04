"use client";

import { useState } from "react";
import { Blocks, Code2 } from "lucide-react";
import BlockTemplateEditor from "./BlockTemplateEditor";
import TemplateBodyEditor from "./TemplateBodyEditor";
import { newBlockId, type ContentBlock } from "@/lib/comms/blocks/types";

interface TemplateEditorModeSwitchProps {
  initialBodyHtml: string;
  initialBlocks: ContentBlock[] | null;
  defaultMode: "visual" | "raw";
  /** Known custom variable_keys for this template, for the Insert Variable picker. */
  customVariableKeys?: string[];
}

export default function TemplateEditorModeSwitch({
  initialBodyHtml,
  initialBlocks,
  defaultMode,
  customVariableKeys = [],
}: TemplateEditorModeSwitchProps) {
  const [mode, setMode] = useState<"visual" | "raw">(defaultMode);

  // Switching an existing raw-HTML template to Visual Builder should wrap
  // its current content into a starting Text block, not discard it.
  const seedBlocks: ContentBlock[] =
    initialBlocks && initialBlocks.length > 0
      ? initialBlocks
      : initialBodyHtml
        ? [{ id: newBlockId(), type: "text", html: initialBodyHtml }]
        : [];

  return (
    <div>
      <div className="mb-2 flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 w-fit">
        <button
          type="button"
          onClick={() => setMode("visual")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "visual" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Blocks size={13} /> Visual Builder
        </button>
        <button
          type="button"
          onClick={() => setMode("raw")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "raw" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Code2 size={13} /> Raw HTML
        </button>
      </div>

      {mode === "raw" && (
        <p className="mb-2 text-xs text-amber-600">
          Switching to Raw HTML and saving gives up block editing for this template — it'll open as raw HTML from
          then on.
        </p>
      )}

      {mode === "visual" ? (
        <BlockTemplateEditor initialBlocks={seedBlocks} customVariableKeys={customVariableKeys} />
      ) : (
        <TemplateBodyEditor initialHtml={initialBodyHtml} customVariableKeys={customVariableKeys} />
      )}
    </div>
  );
}
