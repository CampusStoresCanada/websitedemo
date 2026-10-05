/**
 * Re-author the Rush Recap template in the visual builder's own block format.
 *
 *   npx tsx scripts/author-rush-recap-blocks.mts
 *
 * The first version stored hand-written email-table HTML in body_html. That
 * field belongs to the rich-text/visual editor: opening the template in the
 * UI and saving normalised it to the editor's schema, which dropped the
 * header image, the button and every inline style, and sent a plain-text-
 * looking email. body_html is compiled output, not a place to hand-write
 * layout.
 *
 * ContentBlock[] is the authoring format (lib/comms/blocks/types.ts) and
 * renderBlocksToHtml compiles it, so the builder can round-trip this without
 * destroying it and the compiled HTML is the system's own email markup.
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env may already be set */
}

const { updateTemplate, getTemplateById } = await import("../lib/comms/templates");
type ContentBlock = import("../lib/comms/blocks/types").ContentBlock;

const TEMPLATE_ID = process.argv[2] ?? "8f267dba-dbac-4108-a286-58e865434fd8";
const APP = "https://www.campusstores.ca";
const BRAND_RED = "#EE2A2E";
const bridge = (to: string) => `${APP}/api/circle/member-space?to=${encodeURIComponent(to)}`;

const blocks: ContentBlock[] = [
  {
    id: "header-image",
    type: "image",
    src: `${APP}/email/rush-recap-2026-header.png`,
    alt: "Rush Recap: what even happened this year?",
    widthPercent: 100,
  },
  { id: "gap-1", type: "spacer", height: 16 },
  {
    id: "greeting",
    type: "text",
    html: "<p>Hi {{first_name}},</p>",
  },
  {
    id: "when",
    type: "text",
    html:
      "<p>Rush Recap is this Wednesday, October 7 at {{local_time}}. Ninety minutes, " +
      "stores only, and it's the one call where you find out whether the thing that " +
      "broke in your store broke everywhere.</p>",
  },
  {
    id: "shannon",
    type: "text",
    html:
      "<p>Back in August, Shannon wished us all tills that stayed connected and access " +
      "codes that stayed redeemable. Wednesday is where we find out whose didn't.</p>",
  },
  {
    id: "bring",
    type: "text",
    html:
      "<p>Bring one thing. A number that surprised you, a product that moved or didn't, " +
      "something that broke in week two.</p>",
  },
  {
    id: "cta",
    type: "button",
    text: "Get Registered",
    href: bridge("/c/events/rush-recap"),
    align: "left",
    color: BRAND_RED,
  },
  { id: "gap-2", type: "spacer", height: 8 },
  {
    id: "post-link",
    type: "text",
    html: `<p><a href="${bridge("/c/announcements-f3687d/rush-is-over-was-yours-normal")}">Read the full post on Circle.</a></p>`,
  },
  {
    id: "recording",
    type: "text",
    html:
      '<p>Missed the Town Hall? <a href="https://youtu.be/DPdIF32MoSo">Here\'s the recording ' +
      "to catch you up</a>, no sign-in needed. Don't worry, we'll be posting a lot of the " +
      "details over the next couple of weeks as well.</p>",
  },
  { id: "ps-rule", type: "divider", color: "#e5e7eb" },
  {
    id: "ps",
    type: "text",
    html:
      '<p><strong>P.S.</strong> Were you at the Town Hall? <a href="https://forms.gle/xFudr9BbZdFPhZ27A">' +
      "Tell us what you thought</a>. It takes about a minute.</p>",
  },
];

const result = await updateTemplate(TEMPLATE_ID, { bodyBlocks: blocks });
if (!result.success) {
  console.error("update failed:", result.error);
  process.exit(1);
}

const after = await getTemplateById(TEMPLATE_ID);
const html = after?.body_html ?? "";
console.log(`blocks written: ${blocks.length}`);
console.log(`compiled body_html: ${html.length} chars`);
console.log(`  <img> present:     ${/<img/i.test(html)}`);
console.log(`  button colour:     ${html.includes(BRAND_RED)}`);
console.log(`  <table> layout:    ${/<table/i.test(html)}`);
console.log(`  merge fields:      ${[...new Set(html.match(/\{\{\w+\}\}/g) ?? [])].join(", ")}`);
