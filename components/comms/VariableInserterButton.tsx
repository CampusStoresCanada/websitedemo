"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Braces } from "lucide-react";
import { SYSTEM_VARIABLES, type SystemVariableKey } from "@/lib/comms/variables/registry";
import { CONDITION_SUBJECTS, type ConditionSubjectKey } from "@/lib/comms/conditions/registry";

interface VariableInserterButtonProps {
  /** Template-specific variable_keys, declared by hand — shown alongside the always-available system ones. */
  customKeys: string[];
  onInsert: (key: string) => void;
  title?: string;
}

const PANEL_WIDTH = 288; // w-72
const PANEL_MAX_HEIGHT = 320; // max-h-80
const GAP = 4;

export default function VariableInserterButton({ customKeys, onInsert, title }: VariableInserterButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  // Positioned via a portal to document.body, not CSS `absolute` in place —
  // this toolbar button sits inside block editors that clip overflow (each
  // block card, the text editor's own border wrapper), so an in-place
  // absolute dropdown gets visually squashed to whatever room is left
  // inside that block instead of floating freely over the page.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < PANEL_MAX_HEIGHT + GAP && rect.top > spaceBelow;
    const left = Math.min(rect.left, window.innerWidth - PANEL_WIDTH - GAP);

    setPanelStyle({
      position: "fixed",
      left: Math.max(GAP, left),
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + GAP }
        : { top: rect.bottom + GAP }),
    });
  }, [open]);

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={title ?? "Insert variable"}
        className="inline-flex items-center justify-center w-7 h-7 rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        <Braces size={14} />
      </button>

      {open &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              onWheel={() => setOpen(false)}
            />
            <div
              style={{ ...panelStyle, width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT }}
              className="z-50 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
            >
              <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50 sticky top-0">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Auto-filled</p>
              </div>
              {(Object.entries(SYSTEM_VARIABLES) as [SystemVariableKey, (typeof SYSTEM_VARIABLES)[SystemVariableKey]][]).map(
                ([key, def]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      onInsert(key);
                      setOpen(false);
                    }}
                    className="block w-full text-left px-3 py-1.5 hover:bg-blue-50 transition-colors"
                  >
                    <code className="text-xs text-[#D92327]">{`{{${key}}}`}</code>
                    <p className="text-[10px] text-gray-400">{def.appliesTo}</p>
                  </button>
                )
              )}

              <div className="px-3 py-1.5 border-y border-gray-100 bg-gray-50 sticky top-0">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">From Your Data</p>
                <p className="text-[9px] text-gray-400">
                  Every field the condition system can check — populated when the audience has a resolvable
                  organization/person/event registration.
                </p>
              </div>
              {(Object.entries(CONDITION_SUBJECTS) as [ConditionSubjectKey, (typeof CONDITION_SUBJECTS)[ConditionSubjectKey]][]).map(
                ([subjectKey, subjectDef]) => (
                  <div key={subjectKey}>
                    <p className="px-3 pt-1.5 text-[10px] font-medium text-gray-400">{subjectDef.label}</p>
                    {Object.entries(subjectDef.fields).map(([fieldKey, fieldDef]) => {
                      const varKey = `${subjectKey}_${fieldKey}`;
                      return (
                        <button
                          key={varKey}
                          type="button"
                          onClick={() => {
                            onInsert(varKey);
                            setOpen(false);
                          }}
                          className="block w-full text-left px-3 py-1.5 hover:bg-blue-50 transition-colors"
                        >
                          <code className="text-xs text-[#D92327]">{`{{${varKey}}}`}</code>
                          <p className="text-[10px] text-gray-400">{fieldDef.label}</p>
                        </button>
                      );
                    })}
                  </div>
                )
              )}

              {customKeys.length > 0 && (
                <>
                  <div className="px-3 py-1.5 border-y border-gray-100 bg-gray-50 sticky top-0">
                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                      Custom (this template)
                    </p>
                  </div>
                  {customKeys.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        onInsert(key);
                        setOpen(false);
                      }}
                      className="block w-full text-left px-3 py-1.5 hover:bg-blue-50 transition-colors"
                    >
                      <code className="text-xs text-[#D92327]">{`{{${key}}}`}</code>
                    </button>
                  ))}
                </>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
