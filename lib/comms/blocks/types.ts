// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Visual Template Blocks
// A ContentBlock array is the authoring format for the visual builder;
// it compiles to body_html (see render.ts) at save time. body_html stays
// the one thing every other part of the comms system reads — sending,
// {{variable}} substitution, {{#if}} conditionals, the click map — none
// of it needs to know blocks exist.
// ─────────────────────────────────────────────────────────────────

export type BlockAlign = "left" | "center" | "right";

/**
 * Shared by every block type. `conditionKey` points at a saved condition
 * (see lib/comms/conditions/) — when set, the compiled block is wrapped in
 * a {{#if conditionKey}}...{{/if}} span (see render.ts), so it only
 * appears in the sent email for recipients who satisfy it. Only honored
 * for top-level blocks — see render.ts for why column-nested blocks don't
 * also apply it (would produce genuinely nested {{#if}} markers, which
 * the send-time engine deliberately doesn't support).
 */
interface BlockBase {
  id: string;
  conditionKey?: string | null;
  /** Top-level blocks only (see renderBlock) — wraps the block in a colored table cell. Null/unset = no background. */
  backgroundColor?: string | null;
}

export interface TextBlock extends BlockBase {
  type: "text";
  html: string;
}

export interface ButtonBlock extends BlockBase {
  type: "button";
  text: string;
  href: string;
  align: BlockAlign;
  color: string;
}

export interface ImageBlock extends BlockBase {
  type: "image";
  src: string;
  alt: string;
  href?: string;
  widthPercent: number;
}

export interface DividerBlock extends BlockBase {
  type: "divider";
  color: string;
}

export interface SpacerBlock extends BlockBase {
  type: "spacer";
  height: number;
}

/** The block types a column can hold — deliberately excludes "columns" itself, so nesting stays one level deep with no recursive add/reorder UI needed. */
export type SimpleContentBlock = TextBlock | ButtonBlock | ImageBlock | DividerBlock | SpacerBlock;
export type SimpleContentBlockType = SimpleContentBlock["type"];

export interface ColumnsBlock extends BlockBase {
  type: "columns";
  left: SimpleContentBlock;
  right: SimpleContentBlock;
  /** Left column's width as a percent of the total; right gets the remainder. */
  leftWidthPercent: number;
}

export type ContentBlock = SimpleContentBlock | ColumnsBlock;

export type ContentBlockType = ContentBlock["type"];

export const BLOCK_TYPE_LABELS: Record<ContentBlockType, string> = {
  text: "Text",
  button: "Button",
  image: "Image",
  divider: "Divider",
  spacer: "Spacer",
  columns: "Two Columns",
};

export const SIMPLE_BLOCK_TYPE_LABELS: Record<SimpleContentBlockType, string> = {
  text: "Text",
  button: "Button",
  image: "Image",
  divider: "Divider",
  spacer: "Spacer",
};

export function newBlockId(): string {
  return `blk_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultSimpleBlock(type: SimpleContentBlockType, id: string): SimpleContentBlock {
  switch (type) {
    case "text":
      return { id, type, html: "<p>Write something…</p>" };
    case "button":
      return { id, type, text: "Click Here", href: "https://", align: "center", color: "#EE2A2E" };
    case "image":
      return { id, type, src: "", alt: "", widthPercent: 100 };
    case "divider":
      return { id, type, color: "#E5E7EB" };
    case "spacer":
      return { id, type, height: 24 };
  }
}

export function createDefaultBlock(type: ContentBlockType, id: string): ContentBlock {
  if (type === "columns") {
    return {
      id,
      type,
      left: createDefaultSimpleBlock("text", newBlockId()),
      right: createDefaultSimpleBlock("text", newBlockId()),
      leftWidthPercent: 50,
    };
  }
  return createDefaultSimpleBlock(type, id);
}
