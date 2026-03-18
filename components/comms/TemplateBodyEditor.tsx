"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { useCallback, useEffect, useRef } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link2,
  Quote,
  Minus,
  Undo2,
  Redo2,
} from "lucide-react";

interface TemplateBodyEditorProps {
  initialHtml: string;
  fieldName?: string;
}

// ── Toolbar primitives ────────────────────────────────────────────

function Divider() {
  return <div className="mx-1 h-5 w-px bg-gray-200" />;
}

function ToolbarButton({
  onClick,
  active = false,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        inline-flex items-center justify-center w-8 h-8 rounded-md text-sm transition-all
        ${active
          ? "bg-[#EE2A2E] text-white shadow-sm"
          : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        }
        disabled:opacity-30 disabled:cursor-not-allowed
      `}
    >
      {children}
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────

export default function TemplateBodyEditor({
  initialHtml,
  fieldName = "body_html",
}: TemplateBodyEditorProps) {
  const hiddenRef = useRef<HTMLTextAreaElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({
        placeholder: "Write your email body here. Use {{variable_name}} tokens for dynamic content…",
      }),
    ],
    content: initialHtml,
    onUpdate({ editor }) {
      if (hiddenRef.current) {
        hiddenRef.current.value = editor.getHTML();
      }
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (hiddenRef.current && editor) {
      hiddenRef.current.value = editor.getHTML();
    }
  }, [editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href ?? "";
    const url = window.prompt("URL", prev);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  const ia = (type: string, attrs?: object) => editor.isActive(type, attrs);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">

      {/* ── Header bar ── */}
      <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2">
        <span className="text-xs font-medium text-gray-400 tracking-wide uppercase">Email Body</span>
        <span className="text-xs text-gray-400">
          Use <code className="rounded bg-blue-50 px-1 text-[#EE2A2E] font-mono">{"{{variable}}"}</code> for dynamic content
        </span>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-100 bg-gray-50/60 px-2 py-1.5">

        {/* Text style */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={ia("bold")} title="Bold (⌘B)">
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={ia("italic")} title="Italic (⌘I)">
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={ia("underline")} title="Underline (⌘U)">
          <UnderlineIcon size={14} />
        </ToolbarButton>

        <Divider />

        {/* Headings */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={ia("heading", { level: 1 })} title="Heading 1">
          <Heading1 size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={ia("heading", { level: 2 })} title="Heading 2">
          <Heading2 size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={ia("heading", { level: 3 })} title="Heading 3">
          <Heading3 size={14} />
        </ToolbarButton>

        <Divider />

        {/* Lists */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={ia("bulletList")} title="Bullet list">
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={ia("orderedList")} title="Numbered list">
          <ListOrdered size={14} />
        </ToolbarButton>

        <Divider />

        {/* Alignment */}
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("left").run()} active={ia({ textAlign: "left" })} title="Align left">
          <AlignLeft size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("center").run()} active={ia({ textAlign: "center" })} title="Align center">
          <AlignCenter size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("right").run()} active={ia({ textAlign: "right" })} title="Align right">
          <AlignRight size={14} />
        </ToolbarButton>

        <Divider />

        {/* Extras */}
        <ToolbarButton onClick={setLink} active={ia("link")} title="Insert / edit link">
          <Link2 size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={ia("blockquote")} title="Blockquote">
          <Quote size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
          <Minus size={14} />
        </ToolbarButton>

        <Divider />

        {/* History */}
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (⌘Z)">
          <Undo2 size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (⌘⇧Z)">
          <Redo2 size={14} />
        </ToolbarButton>
      </div>

      {/* ── Editor canvas ── */}
      <EditorContent
        editor={editor}
        className="
          min-h-[420px] max-h-[680px] overflow-y-auto
          px-6 py-5 bg-white
          prose prose-sm max-w-none
          [&_.ProseMirror]:outline-none
          [&_.ProseMirror]:min-h-[380px]
          [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]
          [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-gray-300
          [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left
          [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none
          [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0
        "
      />

      {/* ── Status bar ── */}
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-1.5 flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {editor.storage.characterCount?.characters?.() ?? editor.getText().length} characters
        </span>
        <span className="text-xs text-gray-300">HTML output · saved on submit</span>
      </div>

      {/* Hidden field submitted with the form */}
      <textarea ref={hiddenRef} name={fieldName} defaultValue={initialHtml} className="hidden" readOnly />
    </div>
  );
}
