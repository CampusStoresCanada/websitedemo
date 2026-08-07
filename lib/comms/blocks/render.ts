// ─────────────────────────────────────────────────────────────────
// Chunk 22: Communications — Block → Email HTML Renderer
// Pure function, no server-only imports — shared by the client (live
// preview while editing) and the server (authoritative compile on save).
//
// Table-based markup for button/divider/spacer, plus the deprecated
// `align`/`height` HTML attributes alongside modern CSS, because
// Outlook's desktop rendering engine (Word's, unchanged since 2007)
// ignores flexbox/grid/background-image and is inconsistent about plain
// CSS margins/heights on non-table elements — those old attributes are
// what it actually still honours reliably.
//
// {{variable}} and {{#if}} tokens inside a block's string props (a
// button's href, for instance) pass through completely untouched — this
// only compiles block structure to HTML; substitution/conditionals still
// happen exactly as before, downstream, in lib/comms/templates.ts.
// ─────────────────────────────────────────────────────────────────

import type { ContentBlock } from "./types";
import { BRAND_RED, FONT } from "@/lib/email/layout";

function escAttr(value: string): string {
  return value.replace(/"/g, "&quot;");
}

function renderButton(block: Extract<ContentBlock, { type: "button" }>): string {
  const align = block.align ?? "center";
  const color = block.color || BRAND_RED;
  return `
<div style="text-align:${align};margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${align}" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:${escAttr(color)};">
        <a href="${escAttr(block.href)}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${block.text}</a>
      </td>
    </tr>
  </table>
</div>`.trim();
}

function renderImage(block: Extract<ContentBlock, { type: "image" }>): string {
  const width = Math.min(100, Math.max(1, block.widthPercent || 100));
  const img = `<img src="${escAttr(block.src)}" alt="${escAttr(block.alt)}" style="width:${width}%;max-width:100%;height:auto;display:block;margin:0 auto;border:0;" />`;
  const inner = block.href ? `<a href="${escAttr(block.href)}" target="_blank">${img}</a>` : img;
  return `<div style="text-align:center;margin:16px 0;">${inner}</div>`;
}

function renderDivider(block: Extract<ContentBlock, { type: "divider" }>): string {
  const color = block.color || "#E5E7EB";
  return `
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr><td style="border-top:1px solid ${escAttr(color)};font-size:1px;line-height:1px;">&nbsp;</td></tr>
</table>`.trim();
}

function renderSpacer(block: Extract<ContentBlock, { type: "spacer" }>): string {
  const height = Math.min(200, Math.max(2, block.height || 24));
  return `
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr><td height="${height}" style="height:${height}px;font-size:1px;line-height:1px;">&nbsp;</td></tr>
</table>`.trim();
}

function renderColumns(block: Extract<ContentBlock, { type: "columns" }>): string {
  const leftWidth = Math.min(90, Math.max(10, block.leftWidthPercent || 50));
  const rightWidth = 100 - leftWidth;
  // Two <td>s in one table — Outlook (desktop) doesn't run media queries, so
  // this stays side-by-side on mobile too, same tradeoff most ESPs accept
  // for a simple two-column block rather than a responsive-stacking one.
  //
  // Deliberately calls renderBlockContent (unwrapped), not renderBlock —
  // a column's own conditionKey is never honored (see BlockBase's doc
  // comment in types.ts). Wrapping here too would nest a {{#if}} inside
  // this block's own {{#if}} span when the Columns block itself also has
  // a condition, and renderConditionalBlocks doesn't support nesting.
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
  <tr>
    <td valign="top" width="${leftWidth}%" style="width:${leftWidth}%;padding-right:8px;">
      ${renderBlockContent(block.left)}
    </td>
    <td valign="top" width="${rightWidth}%" style="width:${rightWidth}%;padding-left:8px;">
      ${renderBlockContent(block.right)}
    </td>
  </tr>
</table>`.trim();
}

function renderBlockContent(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.html;
    case "button":
      return renderButton(block);
    case "image":
      return renderImage(block);
    case "divider":
      return renderDivider(block);
    case "spacer":
      return renderSpacer(block);
    case "columns":
      return renderColumns(block);
  }
}

/**
 * Top-level block render, structural content plus the optional
 * {{#if conditionKey}}...{{/if}} visibility wrap — only ever called for
 * blocks in the top-level array (see renderBlocksToHtml and renderColumns
 * above), which is what keeps conditional wrapping to exactly one level.
 */
function renderBlock(block: ContentBlock): string {
  const content = renderBlockContent(block);
  return block.conditionKey ? `{{#if ${block.conditionKey}}}\n${content}\n{{/if}}` : content;
}

export function renderBlocksToHtml(blocks: ContentBlock[]): string {
  return blocks.map(renderBlock).join("\n");
}
