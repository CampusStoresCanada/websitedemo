"use client";

// Shared "/" slash-command menu for Tiptap editors — type "/" to insert
// headings, lists, quotes, etc. Plug into any editor via useSlashCommands().

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

type EditorInstance = NonNullable<ReturnType<typeof useEditor>>;

export interface SlashCmd {
  title: string;
  description: string;
  shortcut: string;
  action: (e: EditorInstance) => void;
}

export const SLASH_COMMANDS: SlashCmd[] = [
  { title: "Heading 1",     description: "Large section heading",   shortcut: "H1", action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { title: "Heading 2",     description: "Medium section heading",  shortcut: "H2", action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { title: "Heading 3",     description: "Small section heading",   shortcut: "H3", action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { title: "Bullet List",   description: "Unordered list",          shortcut: "–",  action: (e) => e.chain().focus().toggleBulletList().run() },
  { title: "Numbered List", description: "Ordered list",            shortcut: "1.", action: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: "Blockquote",    description: "Highlighted callout",     shortcut: '"',  action: (e) => e.chain().focus().toggleBlockquote().run() },
  { title: "Code Block",    description: "Monospace code",          shortcut: "<>", action: (e) => e.chain().focus().toggleCodeBlock().run() },
  { title: "Divider",       description: "Horizontal rule",         shortcut: "—",  action: (e) => e.chain().focus().setHorizontalRule().run() },
];

interface SlashState {
  visible: boolean;
  query: string;
  from: number;
  rect: DOMRect | null;
  selected: number;
}
const CLOSED_SLASH: SlashState = { visible: false, query: "", from: 0, rect: null, selected: 0 };

function buildSlashPlugin(onUpdate: (s: Omit<SlashState, "selected">) => void) {
  return new Plugin({
    key: new PluginKey("slashCommands"),
    view: () => ({
      update(view) {
        const { $from } = view.state.selection;
        const text = $from.parent.textContent.slice(0, $from.parentOffset);
        const idx = text.lastIndexOf("/");
        if (idx === -1 || /\s/.test(text.slice(idx + 1))) {
          onUpdate({ visible: false, query: "", from: 0, rect: null });
          return;
        }
        const coords = view.coordsAtPos($from.pos);
        onUpdate({
          visible: true,
          query: text.slice(idx + 1),
          from: $from.start() + idx,
          rect: new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top),
        });
      },
    }),
  });
}

function SlashMenu({
  commands, rect, selected, onSelect,
}: {
  commands: SlashCmd[];
  rect: DOMRect;
  selected: number;
  onSelect: (c: SlashCmd) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelectorAll("button")[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] w-60 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl text-sm"
      style={{ top: rect.bottom + 6, left: rect.left }}
    >
      {commands.length === 0
        ? <p className="px-3 py-2 text-xs text-gray-400">No commands match</p>
        : commands.map((cmd, i) => (
          <button
            key={cmd.title}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onSelect(cmd); }}
            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === selected ? "bg-[#163D6D]/10" : "hover:bg-gray-50"}`}
          >
            <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded bg-gray-100 text-[10px] font-bold text-gray-500">{cmd.shortcut}</span>
            <div className="min-w-0">
              <p className="font-medium text-gray-800 leading-tight">{cmd.title}</p>
              <p className="text-[11px] text-gray-400 leading-tight">{cmd.description}</p>
            </div>
          </button>
        ))}
    </div>,
    document.body,
  );
}

/**
 * Wires a "/" slash-command menu into any Tiptap editor.
 *
 * Usage:
 *   const editorRef = useRef<EditorInstance | null>(null);
 *   const slash = useSlashCommands(editorRef);
 *   const editor = useEditor({
 *     extensions: [..., slash.extension],
 *     editorProps: { handleKeyDown: (_, e) => slash.handleKeyDown(e) },
 *   });
 *   editorRef.current = editor ?? null;
 *   return <>{...}{slash.menu}</>;
 */
export function useSlashCommands(
  editorRef: RefObject<EditorInstance | null>,
  commands: SlashCmd[] = SLASH_COMMANDS,
) {
  const [slash, setSlash] = useState<SlashState>(CLOSED_SLASH);
  const slashRef = useRef(slash);
  slashRef.current = slash;

  const handleSlashUpdate = useCallback((next: Omit<SlashState, "selected">) => {
    setSlash((prev) => {
      // If nothing meaningful changed, return the same reference — React skips the re-render
      if (
        prev.visible === next.visible &&
        prev.query === next.query &&
        prev.from === next.from
      ) return prev;
      return {
        ...next,
        selected: next.visible ? (next.query !== prev.query ? 0 : prev.selected) : 0,
      };
    });
  }, []);

  const extension = useRef(
    Extension.create({
      name: "slashCommands",
      addProseMirrorPlugins: () => [buildSlashPlugin(handleSlashUpdate)],
    }),
  ).current;

  const runSlash = useCallback((cmd: SlashCmd) => {
    const editor = editorRef.current;
    if (!editor) return;
    const s = slashRef.current;
    const { $from } = editor.state.selection;
    editor.chain().focus().deleteRange({ from: s.from, to: $from.pos }).run();
    cmd.action(editor);
    setSlash(CLOSED_SLASH);
  }, [editorRef]);

  const handleKeyDown = useCallback((event: KeyboardEvent): boolean => {
    const s = slashRef.current;
    if (!s.visible) return false;
    const matches = commands.filter(
      (c) => s.query === "" || c.title.toLowerCase().includes(s.query.toLowerCase()),
    );
    if (event.key === "ArrowDown") { event.preventDefault(); setSlash((p) => ({ ...p, selected: Math.min(p.selected + 1, matches.length - 1) })); return true; }
    if (event.key === "ArrowUp")   { event.preventDefault(); setSlash((p) => ({ ...p, selected: Math.max(p.selected - 1, 0) })); return true; }
    if (event.key === "Enter" && matches[s.selected]) { event.preventDefault(); runSlash(matches[s.selected]); return true; }
    if (event.key === "Escape")    { setSlash(CLOSED_SLASH); return true; }
    return false;
  }, [commands, runSlash]);

  const filtered = commands.filter(
    (c) => slash.query === "" || c.title.toLowerCase().includes(slash.query.toLowerCase()),
  );

  const menu = slash.visible && slash.rect
    ? <SlashMenu commands={filtered} rect={slash.rect} selected={slash.selected} onSelect={runSlash} />
    : null;

  return { extension, handleKeyDown, menu };
}
