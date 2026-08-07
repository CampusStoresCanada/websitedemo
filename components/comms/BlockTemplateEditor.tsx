"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link2,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Type,
  MousePointerClick,
  Image as ImageIcon,
  Minus,
  MoveVertical,
  Columns2,
  Upload,
  GripVertical,
  GitBranch,
  X,
} from "lucide-react";
import { renderBlocksToHtml } from "@/lib/comms/blocks/render";
import { uploadCommsImage } from "@/lib/actions/upload-comms-image";
import {
  createDefaultBlock,
  createDefaultSimpleBlock,
  newBlockId,
  BLOCK_TYPE_LABELS,
  SIMPLE_BLOCK_TYPE_LABELS,
  type BlockAlign,
  type ContentBlock,
  type ContentBlockType,
  type SimpleContentBlock,
  type SimpleContentBlockType,
} from "@/lib/comms/blocks/types";
import VariableInserterButton from "./VariableInserterButton";
import ConditionalInserterModal, { type SavedCondition } from "./ConditionalInserterModal";

interface BlockTemplateEditorProps {
  initialBlocks: ContentBlock[];
  bodyHtmlFieldName?: string;
  blocksFieldName?: string;
  /** Template-specific variable_keys, for the Insert Variable picker alongside the always-available system ones. */
  customVariableKeys?: string[];
}

function insertAtCursor(el: { selectionStart: number | null; selectionEnd: number | null } | null, current: string, insertText: string): string {
  if (!el || el.selectionStart === null) return current + insertText;
  const start = el.selectionStart;
  const end = el.selectionEnd ?? start;
  return current.slice(0, start) + insertText + current.slice(end);
}

const BLOCK_TYPE_ICONS: Record<ContentBlockType, React.ComponentType<{ size?: number }>> = {
  text: Type,
  button: MousePointerClick,
  image: ImageIcon,
  divider: Minus,
  spacer: MoveVertical,
  columns: Columns2,
};

function ImageUploadButton({ onUploaded }: { onUploaded: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadCommsImage(fd);
    setUploading(false);
    if ("error" in result) {
      alert(result.error);
      return;
    }
    onUploaded(result.url);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
      >
        <Upload size={12} /> {uploading ? "Uploading…" : "Upload"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </>
  );
}

/**
 * "Only show this block when…" — wraps the block in {{#if key}}...{{/if}}
 * at compile time (see render.ts). Top-level blocks only; not offered
 * inside a Columns block's left/right editors — see the doc comment on
 * BlockBase in lib/comms/blocks/types.ts for why.
 */
function BlockConditionControl({
  conditionKey,
  conditionLabels,
  onSet,
  onClear,
}: {
  conditionKey: string | null | undefined;
  conditionLabels: Record<string, string>;
  onSet: (condition: SavedCondition) => void;
  onClear: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  if (conditionKey) {
    const label = conditionLabels[conditionKey] ?? conditionKey;
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-amber-50 pl-1.5 pr-1 py-0.5 text-[10px] font-medium text-amber-700"
        title={`Only shown to recipients matching: ${label}`}
      >
        <GitBranch size={10} />
        <span className="max-w-[140px] truncate">{label}</span>
        <button type="button" onClick={onClear} className="rounded p-0.5 text-amber-500 hover:text-amber-800 hover:bg-amber-100" title="Always show this block">
          <X size={10} />
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
        title="Only show this block for recipients matching a condition"
      >
        <GitBranch size={13} />
      </button>
      {modalOpen && (
        <ConditionalInserterModal
          onInsert={(condition) => {
            onSet(condition);
            setModalOpen(false);
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function TextBlockEditor({
  html,
  onChange,
  customKeys,
}: {
  html: string;
  onChange: (html: string) => void;
  customKeys: string[];
}) {
  const editor = useEditor({
    extensions: [StarterKit, Underline, Link.configure({ openOnClick: false })],
    content: html,
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
    immediatelyRender: false,
  });

  if (!editor) return null;
  const ia = (type: string) => editor.isActive(type);

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-0.5 border-b border-gray-100 bg-gray-50/60 px-2 py-1">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={`w-7 h-7 rounded ${ia("bold") ? "bg-[#EE2A2E] text-white" : "text-gray-500 hover:bg-gray-100"}`}>
          <Bold size={13} className="mx-auto" />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={`w-7 h-7 rounded ${ia("italic") ? "bg-[#EE2A2E] text-white" : "text-gray-500 hover:bg-gray-100"}`}>
          <Italic size={13} className="mx-auto" />
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={`w-7 h-7 rounded ${ia("underline") ? "bg-[#EE2A2E] text-white" : "text-gray-500 hover:bg-gray-100"}`}>
          <UnderlineIcon size={13} className="mx-auto" />
        </button>
        <button
          type="button"
          onClick={() => {
            const prev = editor.getAttributes("link").href ?? "";
            const url = window.prompt("URL", prev);
            if (url === null) return;
            if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
            else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }}
          className={`w-7 h-7 rounded ${ia("link") ? "bg-[#EE2A2E] text-white" : "text-gray-500 hover:bg-gray-100"}`}
        >
          <Link2 size={13} className="mx-auto" />
        </button>
        <VariableInserterButton
          customKeys={customKeys}
          onInsert={(key) => editor.chain().focus().insertContent(`{{${key}}}`).run()}
        />
      </div>
      <EditorContent editor={editor} className="px-3 py-2 prose prose-sm max-w-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[60px]" />
    </div>
  );
}

function FieldLabel({ children, inserter }: { children: React.ReactNode; inserter?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-1">
      <label className="text-[11px] font-medium text-gray-500">{children}</label>
      {inserter}
    </div>
  );
}

/**
 * Field editors for the 5 leaf block types — used both for a top-level
 * block and, doubled up, for each side of a Columns block. Kept separate
 * from BlockEditorBody so "columns" can render two of these without any
 * special-casing inside each field editor.
 */
function SimpleBlockFields({
  block,
  onChange,
  customKeys,
}: {
  block: SimpleContentBlock;
  onChange: (block: SimpleContentBlock) => void;
  customKeys: string[];
}) {
  const inputClass = "block w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]";
  // Declared unconditionally (rules of hooks) — only the refs matching the
  // rendered block type actually get attached to a DOM node.
  const buttonTextRef = useRef<HTMLInputElement>(null);
  const buttonHrefRef = useRef<HTMLInputElement>(null);
  const imageAltRef = useRef<HTMLInputElement>(null);

  if (block.type === "text") {
    return <TextBlockEditor html={block.html} onChange={(html) => onChange({ ...block, html })} customKeys={customKeys} />;
  }

  if (block.type === "button") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel
            inserter={
              <VariableInserterButton
                customKeys={customKeys}
                onInsert={(key) => onChange({ ...block, text: insertAtCursor(buttonTextRef.current, block.text, `{{${key}}}`) })}
              />
            }
          >
            Button Text
          </FieldLabel>
          <input ref={buttonTextRef} className={inputClass} value={block.text} onChange={(e) => onChange({ ...block, text: e.target.value })} />
        </div>
        <div>
          <FieldLabel
            inserter={
              <VariableInserterButton
                customKeys={customKeys}
                onInsert={(key) => onChange({ ...block, href: insertAtCursor(buttonHrefRef.current, block.href, `{{${key}}}`) })}
              />
            }
          >
            Link
          </FieldLabel>
          <input ref={buttonHrefRef} className={inputClass} value={block.href} placeholder="https:// or {{variable}}" onChange={(e) => onChange({ ...block, href: e.target.value })} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Align</label>
          <select className={inputClass} value={block.align} onChange={(e) => onChange({ ...block, align: e.target.value as BlockAlign })}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Color</label>
          <input type="color" className="block w-full h-9 rounded-lg border border-gray-300" value={block.color} onChange={(e) => onChange({ ...block, color: e.target.value })} />
        </div>
      </div>
    );
  }

  if (block.type === "image") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Image</label>
          <div className="flex items-center gap-2">
            <input className={inputClass} value={block.src} placeholder="https://… or upload" onChange={(e) => onChange({ ...block, src: e.target.value })} />
            <ImageUploadButton onUploaded={(url) => onChange({ ...block, src: url })} />
          </div>
        </div>
        <div>
          <FieldLabel
            inserter={
              <VariableInserterButton
                customKeys={customKeys}
                onInsert={(key) => onChange({ ...block, alt: insertAtCursor(imageAltRef.current, block.alt, `{{${key}}}`) })}
              />
            }
          >
            Alt Text
          </FieldLabel>
          <input ref={imageAltRef} className={inputClass} value={block.alt} onChange={(e) => onChange({ ...block, alt: e.target.value })} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Link (optional)</label>
          <input className={inputClass} value={block.href ?? ""} onChange={(e) => onChange({ ...block, href: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Width: {block.widthPercent}%</label>
          <input
            type="range"
            min={10}
            max={100}
            value={block.widthPercent}
            onChange={(e) => onChange({ ...block, widthPercent: Number(e.target.value) })}
            className="w-full"
          />
        </div>
      </div>
    );
  }

  if (block.type === "divider") {
    return (
      <div className="w-40">
        <label className="block text-[11px] font-medium text-gray-500 mb-1">Color</label>
        <input type="color" className="block w-full h-9 rounded-lg border border-gray-300" value={block.color} onChange={(e) => onChange({ ...block, color: e.target.value })} />
      </div>
    );
  }

  // spacer
  return (
    <div className="w-40">
      <label className="block text-[11px] font-medium text-gray-500 mb-1">Height: {block.height}px</label>
      <input
        type="range"
        min={4}
        max={120}
        value={block.height}
        onChange={(e) => onChange({ ...block, height: Number(e.target.value) })}
        className="w-full"
      />
    </div>
  );
}

/** One side of a Columns block — a type picker (restricted to the 5 leaf types) plus that type's fields. Changing the type replaces the column's block with a fresh default of the new type. */
function ColumnEditor({
  block,
  onChange,
  customKeys,
  label,
}: {
  block: SimpleContentBlock;
  onChange: (block: SimpleContentBlock) => void;
  customKeys: string[];
  label: string;
}) {
  return (
    <div className="flex-1 min-w-0 rounded-lg border border-gray-100 bg-gray-50/50 p-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <select
          className="rounded border border-gray-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#163D6D]/30"
          value={block.type}
          onChange={(e) => onChange(createDefaultSimpleBlock(e.target.value as SimpleContentBlockType, block.id))}
        >
          {(Object.keys(SIMPLE_BLOCK_TYPE_LABELS) as SimpleContentBlockType[]).map((t) => (
            <option key={t} value={t}>{SIMPLE_BLOCK_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>
      <SimpleBlockFields block={block} onChange={onChange} customKeys={customKeys} />
    </div>
  );
}

function BlockEditorBody({
  block,
  onChange,
  customKeys,
}: {
  block: ContentBlock;
  onChange: (block: ContentBlock) => void;
  customKeys: string[];
}) {
  if (block.type === "columns") {
    return (
      <div className="space-y-2.5">
        <div className="flex gap-2.5">
          <ColumnEditor
            label="Left"
            block={block.left}
            customKeys={customKeys}
            onChange={(left) => onChange({ ...block, left })}
          />
          <ColumnEditor
            label="Right"
            block={block.right}
            customKeys={customKeys}
            onChange={(right) => onChange({ ...block, right })}
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">
            Column split: {block.leftWidthPercent}% / {100 - block.leftWidthPercent}%
          </label>
          <input
            type="range"
            min={20}
            max={80}
            value={block.leftWidthPercent}
            onChange={(e) => onChange({ ...block, leftWidthPercent: Number(e.target.value) })}
            className="w-full"
          />
        </div>
      </div>
    );
  }

  return <SimpleBlockFields block={block} onChange={onChange} customKeys={customKeys} />;
}

export default function BlockTemplateEditor({
  initialBlocks,
  bodyHtmlFieldName = "body_html",
  blocksFieldName = "body_blocks_json",
  customVariableKeys = [],
}: BlockTemplateEditorProps) {
  const [blocks, setBlocks] = useState<ContentBlock[]>(
    initialBlocks.length > 0 ? initialBlocks : [createDefaultBlock("text", newBlockId())]
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const bodyHtmlRef = useRef<HTMLTextAreaElement>(null);
  const blocksJsonRef = useRef<HTMLInputElement>(null);
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Label lookup for any block.conditionKey already set (e.g. loaded from
  // a saved template) — fetched once so the badge shows a human label
  // immediately instead of the raw key. A freshly-picked condition merges
  // in via BlockConditionControl's onSet without waiting for a refetch.
  const [conditionLabels, setConditionLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/admin/comms/conditions")
      .then((r) => r.json())
      .then((data: { conditions?: SavedCondition[] }) => {
        setConditionLabels(Object.fromEntries((data.conditions ?? []).map((c) => [c.key, c.label])));
      })
      .catch(() => {});
  }, []);

  const compiledHtml = useMemo(() => renderBlocksToHtml(blocks), [blocks]);

  useEffect(() => {
    if (bodyHtmlRef.current) bodyHtmlRef.current.value = compiledHtml;
    if (blocksJsonRef.current) blocksJsonRef.current.value = JSON.stringify(blocks);
  }, [compiledHtml, blocks]);

  function updateBlock(index: number, updated: ContentBlock) {
    setBlocks((prev) => prev.map((b, i) => (i === index ? updated : b)));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setBlocks((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function reorderBlock(fromIndex: number, toIndex: number) {
    setBlocks((prev) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= prev.length || toIndex >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  function deleteBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }

  function addBlock(type: ContentBlockType) {
    setBlocks((prev) => [...prev, createDefaultBlock(type, newBlockId())]);
    setAddMenuOpen(false);
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        const Icon = BLOCK_TYPE_ICONS[block.type];
        return (
          <div
            key={block.id}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIndex.current !== null && dragIndex.current !== index) setDragOverIndex(index);
            }}
            onDragLeave={() => setDragOverIndex((v) => (v === index ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex.current !== null) reorderBlock(dragIndex.current, index);
              dragIndex.current = null;
              setDragOverIndex(null);
            }}
            className={`rounded-xl border bg-white overflow-hidden transition-colors ${
              dragOverIndex === index ? "border-accent border-2" : "border-gray-200"
            }`}
          >
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50">
              <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                <span
                  draggable
                  onDragStart={(e) => {
                    dragIndex.current = index;
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    dragIndex.current = null;
                    setDragOverIndex(null);
                  }}
                  className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500"
                  title="Drag to reorder"
                >
                  <GripVertical size={13} />
                </span>
                <Icon size={13} /> {BLOCK_TYPE_LABELS[block.type]}
              </span>
              <div className="flex items-center gap-1">
                <BlockConditionControl
                  conditionKey={block.conditionKey}
                  conditionLabels={conditionLabels}
                  onSet={(condition) => {
                    setConditionLabels((prev) => ({ ...prev, [condition.key]: condition.label }));
                    updateBlock(index, { ...block, conditionKey: condition.key });
                  }}
                  onClear={() => updateBlock(index, { ...block, conditionKey: null })}
                />
                <div className="w-px h-4 bg-gray-200 mx-0.5" />
                <button type="button" onClick={() => moveBlock(index, -1)} disabled={index === 0} className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30">
                  <ArrowUp size={13} />
                </button>
                <button type="button" onClick={() => moveBlock(index, 1)} disabled={index === blocks.length - 1} className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30">
                  <ArrowDown size={13} />
                </button>
                <button type="button" onClick={() => deleteBlock(index)} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <div className="p-3">
              <BlockEditorBody block={block} onChange={(updated) => updateBlock(index, updated)} customKeys={customVariableKeys} />
            </div>
          </div>
        );
      })}

      <div className="relative">
        <button
          type="button"
          onClick={() => setAddMenuOpen((v) => !v)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
        >
          <Plus size={14} /> Add Block
        </button>
        {addMenuOpen && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
            {(Object.keys(BLOCK_TYPE_LABELS) as ContentBlockType[]).map((type) => {
              const Icon = BLOCK_TYPE_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => addBlock(type)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-accent transition-colors"
                >
                  <Icon size={14} /> {BLOCK_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <textarea ref={bodyHtmlRef} name={bodyHtmlFieldName} defaultValue={compiledHtml} className="hidden" readOnly />
      <input ref={blocksJsonRef} type="hidden" name={blocksFieldName} defaultValue={JSON.stringify(blocks)} />
    </div>
  );
}
