"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";


// ─── Slash commands catalogue ─────────────────────────────────────────────────

interface SlashCommand {
  title: string;
  description: string;
  shortcut: string;
  action: (editor: NonNullable<ReturnType<typeof useEditor>>) => void;
}

const COMMANDS: SlashCommand[] = [
  {
    title: "Heading 1",
    description: "Large section heading",
    shortcut: "H1",
    action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    shortcut: "H2",
    action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    shortcut: "–",
    action: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    shortcut: "1.",
    action: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "Blockquote",
    description: "Highlighted callout or quote",
    shortcut: '"',
    action: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    title: "Code Block",
    description: "Monospace code",
    shortcut: "<>",
    action: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

// ─── Slash state type ─────────────────────────────────────────────────────────

interface SlashState {
  visible: boolean;
  query: string;
  from: number;          // doc position of the "/" character
  rect: DOMRect | null;  // cursor rect for menu positioning
  selected: number;
}

const CLOSED: SlashState = { visible: false, query: "", from: 0, rect: null, selected: 0 };

// ─── ProseMirror plugin ───────────────────────────────────────────────────────

function buildSlashPlugin(
  onUpdate: (state: Omit<SlashState, "selected">) => void,
) {
  return new Plugin({
    key: new PluginKey("slashCommands"),
    view() {
      return {
        update(view) {
          const { state } = view;
          const { selection } = state;
          const { $from } = selection;
          const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
          const slashIdx = textBefore.lastIndexOf("/");

          if (slashIdx === -1) {
            onUpdate({ visible: false, query: "", from: 0, rect: null });
            return;
          }

          const afterSlash = textBefore.slice(slashIdx + 1);
          // close if there's a space after the slash
          if (/\s/.test(afterSlash)) {
            onUpdate({ visible: false, query: "", from: 0, rect: null });
            return;
          }

          const from = $from.start() + slashIdx;
          const coords = view.coordsAtPos($from.pos);
          const rect = new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);

          onUpdate({ visible: true, query: afterSlash, from, rect });
        },
      };
    },
  });
}

// ─── Slash menu component ─────────────────────────────────────────────────────

function SlashMenu({
  commands,
  rect,
  selected,
  onSelect,
}: {
  commands: SlashCommand[];
  rect: DOMRect;
  selected: number;
  onSelect: (cmd: SlashCommand) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Flip above cursor if near bottom
  const top = rect.bottom + window.scrollY + 6;
  const left = rect.left + window.scrollX;

  useEffect(() => {
    menuRef.current
      ?.querySelectorAll("button")
      [selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] w-60 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl text-sm"
      style={{ top, left }}
    >
      {commands.length === 0 ? (
        <p className="px-3 py-2 text-xs text-gray-400">No commands match</p>
      ) : (
        commands.map((cmd, i) => (
          <button
            key={cmd.title}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(cmd);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
              i === selected ? "bg-gray-100" : "hover:bg-gray-50"
            }`}
          >
            <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded bg-gray-100 text-[10px] font-bold text-gray-500">
              {cmd.shortcut}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-gray-800 leading-tight">{cmd.title}</p>
              <p className="text-[11px] text-gray-400 leading-tight">{cmd.description}</p>
            </div>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}

// ─── Bubble toolbar button ────────────────────────────────────────────────────

function BubbleBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-7 w-7 flex items-center justify-center rounded text-sm transition-colors ${
        active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "Write something…",
  className = "",
  minHeight = "120px",
}: RichTextEditorProps) {
  const [slash, setSlash] = useState<SlashState>(CLOSED);
  const slashRef = useRef(slash);
  slashRef.current = slash;

  const handleSlashUpdate = useCallback(
    (next: Omit<SlashState, "selected">) => {
      setSlash((prev) => ({
        ...next,
        selected: next.visible ? (next.query !== prev.query ? 0 : prev.selected) : 0,
      }));
    },
    [],
  );

  const SlashExtension = useRef(
    Extension.create({
      name: "slashCommands",
      addProseMirrorPlugins: () => [buildSlashPlugin(handleSlashUpdate)],
    }),
  ).current;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "underline text-blue-600 cursor-pointer" },
      }),
      Placeholder.configure({ placeholder }),
      SlashExtension,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "outline-none",
        style: `min-height: ${minHeight}`,
      },
      handleKeyDown(_, event) {
        const s = slashRef.current;
        if (!s.visible) return false;

        const filtered = COMMANDS.filter(
          (c) =>
            s.query === "" ||
            c.title.toLowerCase().includes(s.query.toLowerCase()) ||
            c.description.toLowerCase().includes(s.query.toLowerCase()),
        );

        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlash((p) => ({ ...p, selected: Math.min(p.selected + 1, filtered.length - 1) }));
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlash((p) => ({ ...p, selected: Math.max(p.selected - 1, 0) }));
          return true;
        }
        if (event.key === "Enter" && filtered[s.selected]) {
          event.preventDefault();
          runCommand(filtered[s.selected]);
          return true;
        }
        if (event.key === "Escape") {
          setSlash(CLOSED);
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  // Sync external value (e.g. form reset)
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const runCommand = useCallback(
    (cmd: SlashCommand) => {
      if (!editor) return;
      const s = slashRef.current;
      const { $from } = editor.state.selection;
      editor.chain().focus().deleteRange({ from: s.from, to: $from.pos }).run();
      cmd.action(editor);
      setSlash(CLOSED);
    },
    [editor],
  );

  const filtered = COMMANDS.filter(
    (c) =>
      slash.query === "" ||
      c.title.toLowerCase().includes(slash.query.toLowerCase()) ||
      c.description.toLowerCase().includes(slash.query.toLowerCase()),
  );

  if (!editor) return null;

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-[var(--brand-red)] focus-within:border-transparent transition-shadow ${className}`}
    >
      {/* Bubble menu — appears on text selection */}
      <BubbleMenu
        editor={editor}
        className="flex items-center gap-0.5 rounded-md border border-gray-200 bg-white p-1 shadow-lg"
      >
        <BubbleBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <strong>B</strong>
        </BubbleBtn>
        <BubbleBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <em>I</em>
        </BubbleBtn>
        <BubbleBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <s>S</s>
        </BubbleBtn>
        <BubbleBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">
          <code className="font-mono text-[11px]">`</code>
        </BubbleBtn>
        <div className="mx-1 h-4 w-px bg-gray-200" />
        <BubbleBtn
          active={editor.isActive("link")}
          title="Link"
          onClick={() => {
            if (editor.isActive("link")) {
              editor.chain().focus().unsetLink().run();
            } else {
              const url = window.prompt("URL");
              if (url) editor.chain().focus().setLink({ href: url }).run();
            }
          }}
        >
          <span className="text-xs">🔗</span>
        </BubbleBtn>
      </BubbleMenu>

      {/* Editor body */}
      <EditorContent
        editor={editor}
        className="px-3 py-2.5 prose prose-sm prose-gray max-w-none
          [&_.ProseMirror]:outline-none
          [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]
          [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-gray-400
          [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left
          [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none
          [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
      />

      {/* Slash hint */}
      <div className="px-3 pb-2 flex items-center gap-1">
        <span className="text-[10px] text-gray-300">Type</span>
        <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1 py-px font-mono leading-none">/</kbd>
        <span className="text-[10px] text-gray-300">for formatting</span>
      </div>

      {/* Slash menu portal */}
      {slash.visible && slash.rect && (
        <SlashMenu
          commands={filtered}
          rect={slash.rect}
          selected={slash.selected}
          onSelect={runCommand}
        />
      )}
    </div>
  );
}
