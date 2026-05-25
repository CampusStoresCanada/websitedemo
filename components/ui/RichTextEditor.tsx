"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import TiptapLink from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TiptapImage from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { uploadEditorImage } from "@/lib/actions/upload-editor-image";

// ─── Types ────────────────────────────────────────────────────────────────────

type EditorInstance = NonNullable<ReturnType<typeof useEditor>>;

interface MentionItem {
  id: string;
  label: string;
  sublabel: string;
  href: string;
  type: "org" | "contact";
}

interface GiphyResult {
  id: string;
  title: string;
  url: string;       // fixed-width gif
  preview: string;   // fixed-width still
}

// ─── Slash commands ───────────────────────────────────────────────────────────

interface SlashCmd {
  title: string;
  description: string;
  shortcut: string;
  action: (e: EditorInstance) => void;
}

const SLASH_COMMANDS: SlashCmd[] = [
  { title: "Heading 1",     description: "Large section heading",   shortcut: "H1", action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { title: "Heading 2",     description: "Medium section heading",  shortcut: "H2", action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { title: "Bullet List",   description: "Unordered list",          shortcut: "–",  action: (e) => e.chain().focus().toggleBulletList().run() },
  { title: "Numbered List", description: "Ordered list",            shortcut: "1.", action: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: "Blockquote",    description: "Highlighted callout",     shortcut: '"',  action: (e) => e.chain().focus().toggleBlockquote().run() },
  { title: "Code Block",    description: "Monospace code",          shortcut: "<>", action: (e) => e.chain().focus().toggleCodeBlock().run() },
];

// ─── Slash plugin ─────────────────────────────────────────────────────────────

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

// ─── Slash menu ───────────────────────────────────────────────────────────────

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
      style={{ top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX }}
    >
      {commands.length === 0
        ? <p className="px-3 py-2 text-xs text-gray-400">No commands match</p>
        : commands.map((cmd, i) => (
          <button
            key={cmd.title}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onSelect(cmd); }}
            className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === selected ? "bg-gray-100" : "hover:bg-gray-50"}`}
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

// ─── Mention suggestion list ──────────────────────────────────────────────────

function MentionList({
  items, rect, selected, onSelect,
}: {
  items: MentionItem[];
  rect: DOMRect;
  selected: number;
  onSelect: (item: MentionItem) => void;
}) {
  return createPortal(
    <div
      className="fixed z-[9999] w-64 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl text-sm"
      style={{ top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX }}
    >
      {items.length === 0
        ? <p className="px-3 py-2 text-xs text-gray-400">No results</p>
        : items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${i === selected ? "bg-gray-100" : "hover:bg-gray-50"}`}
          >
            <span className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full text-[10px] font-bold text-white ${item.type === "org" ? "bg-[#163D6D]" : "bg-gray-400"}`}>
              {item.type === "org" ? "O" : "C"}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-gray-800 leading-tight truncate">{item.label}</p>
              {item.sublabel && <p className="text-[11px] text-gray-400 leading-tight truncate">{item.sublabel}</p>}
            </div>
          </button>
        ))}
    </div>,
    document.body,
  );
}

// ─── Giphy panel ──────────────────────────────────────────────────────────────

const GIPHY_KEY = process.env.NEXT_PUBLIC_GIPHY_API_KEY ?? "";

function GiphyPanel({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GiphyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const search = useCallback(async (q: string) => {
    if (!GIPHY_KEY) return;
    setLoading(true);
    try {
      const endpoint = q.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=12&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=12&rating=g`;
      const res = await fetch(endpoint);
      const json = await res.json();
      setResults(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (json.data ?? []).map((g: any) => ({
          id: g.id,
          title: g.title,
          url: g.images.fixed_width.url,
          preview: g.images.fixed_width_still.url,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Load trending on mount
  useEffect(() => { search(""); }, [search]);

  const handleQuery = (q: string) => {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(q), 400);
  };

  if (!GIPHY_KEY) {
    return (
      <div className="p-4 text-center text-sm text-gray-500">
        <p className="font-medium text-gray-700 mb-1">Giphy not configured</p>
        <p className="text-xs">Add <code className="bg-gray-100 px-1 rounded">NEXT_PUBLIC_GIPHY_API_KEY</code> to your environment.</p>
      </div>
    );
  }

  return (
    <div className="w-72">
      <div className="p-2 border-b border-gray-100">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => handleQuery(e.target.value)}
          placeholder="Search GIFs…"
          className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--brand-red)] focus:border-transparent"
        />
      </div>
      <div className="p-2 grid grid-cols-3 gap-1 max-h-56 overflow-y-auto">
        {loading && <p className="col-span-3 py-4 text-center text-xs text-gray-400">Searching…</p>}
        {!loading && results.length === 0 && <p className="col-span-3 py-4 text-center text-xs text-gray-400">No results</p>}
        {results.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => { onSelect(g.url); onClose(); }}
            className="aspect-square overflow-hidden rounded hover:ring-2 hover:ring-[var(--brand-red)] transition-all"
          >
            <img src={g.preview} alt={g.title} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
      <div className="px-2 pb-1.5 text-right">
        <span className="text-[9px] text-gray-300 uppercase tracking-wider">Powered by GIPHY</span>
      </div>
    </div>
  );
}

// ─── Bubble toolbar button ────────────────────────────────────────────────────

function BubbleBtn({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-7 w-7 flex items-center justify-center rounded text-sm transition-colors ${active ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}
    >
      {children}
    </button>
  );
}

// ─── Bottom toolbar button ────────────────────────────────────────────────────

function ToolbarBtn({ onClick, title, children, active = false }: {
  onClick: () => void; title: string; children: React.ReactNode; active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-7 w-7 flex items-center justify-center rounded text-base transition-colors ${active ? "text-[var(--brand-red)]" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"}`}
    >
      {children}
    </button>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

type Popover = "emoji" | "giphy" | null;

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
  // ── Slash state ──
  const [slash, setSlash] = useState<SlashState>(CLOSED_SLASH);
  const slashRef = useRef(slash);
  slashRef.current = slash;

  // ── Mention state ──
  const [mention, setMention] = useState<{
    visible: boolean; items: MentionItem[]; rect: DOMRect | null; selected: number; from: number; query: string;
  }>({ visible: false, items: [], rect: null, selected: 0, from: 0, query: "" });
  const mentionRef = useRef(mention);
  mentionRef.current = mention;

  // ── Popover state (emoji / giphy) ──
  const [popover, setPopover] = useState<Popover>(null);

  // ── Image upload ──
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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

  const SlashExtension = useRef(
    Extension.create({
      name: "slashCommands",
      addProseMirrorPlugins: () => [buildSlashPlugin(handleSlashUpdate)],
    }),
  ).current;

  // Mention suggestion handler (passed to Mention extension)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mentionSuggestion = useRef<any>({
    char: "@",
    allowSpaces: false,
    startOfLine: false,
    items: async ({ query }: { query: string }) => {
      if (query.length === 0) return [];
      try {
        const res = await fetch(`/api/search/mentions?q=${encodeURIComponent(query)}`);
        return res.ok ? await res.json() : [];
      } catch {
        return [];
      }
    },
    render: () => {
      let rect: DOMRect | null = null;
      return {
        onStart(props: { items: MentionItem[]; clientRect?: (() => DOMRect | null) | null; range: { from: number } }) {
          rect = props.clientRect?.() ?? null;
          setMention({ visible: true, items: props.items, rect, selected: 0, from: props.range.from, query: "" });
        },
        onUpdate(props: { items: MentionItem[]; clientRect?: (() => DOMRect | null) | null; range: { from: number }; query: string }) {
          rect = props.clientRect?.() ?? rect;
          setMention((prev) => ({ ...prev, items: props.items, rect: rect ?? prev.rect, from: props.range.from, query: props.query, selected: 0 }));
        },
        onKeyDown({ event }: { event: KeyboardEvent }) {
          const m = mentionRef.current;
          if (!m.visible) return false;
          if (event.key === "ArrowDown") {
            setMention((p) => ({ ...p, selected: Math.min(p.selected + 1, p.items.length - 1) }));
            return true;
          }
          if (event.key === "ArrowUp") {
            setMention((p) => ({ ...p, selected: Math.max(p.selected - 1, 0) }));
            return true;
          }
          if (event.key === "Enter") {
            const item = m.items[m.selected];
            if (item) { selectMention(item); return true; }
          }
          if (event.key === "Escape") {
            setMention((p) => ({ ...p, visible: false }));
            return true;
          }
          return false;
        },
        onExit() {
          setMention((p) => ({ ...p, visible: false }));
        },
      };
    },
  }).current;

  const editorRef = useRef<EditorInstance | null>(null);

  const selectMention = useCallback((item: MentionItem) => {
    editorRef.current
      ?.chain()
      .focus()
      .insertContent(`<a href="${item.href}" data-mention="${item.id}">@${item.label}</a> `)
      .run();
    setMention((p) => ({ ...p, visible: false }));
  }, []);

  const runSlash = useCallback((cmd: SlashCmd) => {
    if (!editorRef.current) return;
    const s = slashRef.current;
    const { $from } = editorRef.current.state.selection;
    editorRef.current.chain().focus().deleteRange({ from: s.from, to: $from.pos }).run();
    cmd.action(editorRef.current);
    setSlash(CLOSED_SLASH);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TiptapLink.configure({ openOnClick: false, HTMLAttributes: { class: "underline text-blue-600 cursor-pointer" } }),
      Placeholder.configure({ placeholder }),
      TiptapImage.configure({ HTMLAttributes: { class: "max-w-full rounded-lg my-2" } }),
      Mention.configure({
        HTMLAttributes: { class: "text-[var(--brand-red)] font-medium cursor-pointer" },
        suggestion: mentionSuggestion,
      }),
      SlashExtension,
    ],
    content: value,
    editorProps: {
      attributes: { class: "outline-none", style: `min-height: ${minHeight}` },
      handleKeyDown(_, event) {
        const s = slashRef.current;
        if (!s.visible) return false;
        const filtered = SLASH_COMMANDS.filter(
          (c) => s.query === "" || c.title.toLowerCase().includes(s.query.toLowerCase()),
        );
        if (event.key === "ArrowDown") { event.preventDefault(); setSlash((p) => ({ ...p, selected: Math.min(p.selected + 1, filtered.length - 1) })); return true; }
        if (event.key === "ArrowUp")   { event.preventDefault(); setSlash((p) => ({ ...p, selected: Math.max(p.selected - 1, 0) })); return true; }
        if (event.key === "Enter" && filtered[s.selected]) { event.preventDefault(); runSlash(filtered[s.selected]); return true; }
        if (event.key === "Escape")    { setSlash(CLOSED_SLASH); return true; }
        return false;
      },
    },
    onUpdate({ editor }) { onChange(editor.getHTML()); },
  });

  editorRef.current = editor ?? null;

  useEffect(() => {
    if (!editor || editor.getHTML() === value) return;
    editor.commands.setContent(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close popover on outside click
  useEffect(() => {
    if (!popover) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest("[data-popover]") && !target.closest("[data-popover-trigger]")) {
        setPopover(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popover]);

  const handleImageFile = useCallback(async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadEditorImage(fd);
    setUploading(false);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    editorRef.current?.chain().focus().setImage({ src: result.url }).run();
  }, []);

  const filteredSlash = SLASH_COMMANDS.filter(
    (c) => slash.query === "" || c.title.toLowerCase().includes(slash.query.toLowerCase()),
  );

  if (!editor) return null;

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-[var(--brand-red)] focus-within:border-transparent transition-shadow ${className}`}
    >
      {/* Bubble menu */}
      <BubbleMenu
        editor={editor}
        className="flex items-center gap-0.5 rounded-md border border-gray-200 bg-white p-1 shadow-lg"
      >
        <BubbleBtn active={editor.isActive("bold")}   onClick={() => editor.chain().focus().toggleBold().run()}   title="Bold"><strong>B</strong></BubbleBtn>
        <BubbleBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><em>I</em></BubbleBtn>
        <BubbleBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><s>S</s></BubbleBtn>
        <BubbleBtn active={editor.isActive("code")}   onClick={() => editor.chain().focus().toggleCode().run()}   title="Inline code"><code className="font-mono text-[11px]">`</code></BubbleBtn>
        <div className="mx-1 h-4 w-px bg-gray-200" />
        <BubbleBtn
          active={editor.isActive("link")}
          title="Link"
          onClick={() => {
            if (editor.isActive("link")) { editor.chain().focus().unsetLink().run(); return; }
            const url = window.prompt("URL");
            if (url) editor.chain().focus().setLink({ href: url }).run();
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

      {/* Bottom toolbar */}
      <div className="px-2 pb-2 flex items-center gap-0.5 border-t border-gray-100 pt-1.5">
        {/* Image upload */}
        <div className="relative">
          <ToolbarBtn
            title="Insert image"
            onClick={() => imageInputRef.current?.click()}
            active={uploading}
          >
            {uploading ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M1 5.5A2.5 2.5 0 013.5 3h13A2.5 2.5 0 0119 5.5v9A2.5 2.5 0 0116.5 17h-13A2.5 2.5 0 011 14.5v-9zm2.5-.5a.5.5 0 00-.5.5v5.95l3.22-3.22a.75.75 0 011.06 0l2.44 2.44 1.69-1.69a.75.75 0 011.06 0L15 11.56V5.5a.5.5 0 00-.5-.5h-11zM3 14.5v-.68l3.75-3.75 2.44 2.44a.75.75 0 001.06 0l1.69-1.69 2.81 2.81H3.5a.5.5 0 01-.5-.5zm5.25-7.25a1.25 1.25 0 11-2.5 0 1.25 1.25 0 012.5 0z" clipRule="evenodd"/></svg>
            )}
          </ToolbarBtn>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Emoji picker */}
        <div className="relative" data-popover-trigger>
          <ToolbarBtn title="Insert emoji" active={popover === "emoji"} onClick={() => setPopover(popover === "emoji" ? null : "emoji")}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-3.5-7.5a1 1 0 100-2 1 1 0 000 2zm7 0a1 1 0 100-2 1 1 0 000 2zm-7.293 3.207a.75.75 0 011.06 0A3.496 3.496 0 0010 14.75c.97 0 1.845-.393 2.475-1.025a.75.75 0 011.06 1.06A4.996 4.996 0 0110 16.25a4.996 4.996 0 01-3.535-1.464.75.75 0 010-1.06z" clipRule="evenodd"/></svg>
          </ToolbarBtn>
          {popover === "emoji" && (
            <div data-popover className="absolute bottom-full left-0 mb-1 z-50">
              <Picker
                data={data}
                theme="light"
                previewPosition="none"
                skinTonePosition="none"
                onEmojiSelect={(e: { native: string }) => {
                  editor.chain().focus().insertContent(e.native).run();
                  setPopover(null);
                }}
              />
            </div>
          )}
        </div>

        {/* GIF / Giphy */}
        <div className="relative" data-popover-trigger>
          <ToolbarBtn title="Insert GIF" active={popover === "giphy"} onClick={() => setPopover(popover === "giphy" ? null : "giphy")}>
            <span className="text-[10px] font-bold tracking-tighter leading-none">GIF</span>
          </ToolbarBtn>
          {popover === "giphy" && (
            <div data-popover className="absolute bottom-full left-0 mb-1 z-50 rounded-lg border border-gray-200 bg-white shadow-xl overflow-hidden">
              <GiphyPanel
                onSelect={(url) => {
                  editor.chain().focus().setImage({ src: url, alt: "GIF" }).run();
                }}
                onClose={() => setPopover(null)}
              />
            </div>
          )}
        </div>

        {/* @ Mention */}
        <ToolbarBtn
          title="Mention a contact or organization"
          onClick={() => {
            editor.chain().focus().insertContent("@").run();
          }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M14.243 5.757a6 6 0 10-.986 9.284 1 1 0 111.087 1.678A8 8 0 1118 10a3 3 0 01-4.8 2.401A4 4 0 1114 10a2 2 0 002 2 1 1 0 010 2 4 4 0 01-4-4 2 2 0 10-2 2 1 1 0 010 2A4 4 0 1110 6a6 6 0 004.243-.243z" clipRule="evenodd"/></svg>
        </ToolbarBtn>

        {/* Hint */}
        <div className="ml-auto flex items-center gap-1 pl-2">
          <span className="text-[10px] text-gray-300">Type</span>
          <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1 py-px font-mono leading-none">/</kbd>
          <span className="text-[10px] text-gray-300">for formatting</span>
        </div>
      </div>

      {/* Slash menu portal */}
      {slash.visible && slash.rect && (
        <SlashMenu commands={filteredSlash} rect={slash.rect} selected={slash.selected} onSelect={runSlash} />
      )}

      {/* Mention list portal */}
      {mention.visible && mention.rect && mention.items.length > 0 && (
        <MentionList items={mention.items} rect={mention.rect} selected={mention.selected} onSelect={selectMention} />
      )}
    </div>
  );
}
