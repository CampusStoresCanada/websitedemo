/**
 * Emits the CSC website's minutes HTML from the same data.json that builds the
 * .docx. Standalone on purpose — it needs no `docx` dependency, so the website
 * copy can be regenerated anywhere, including environments where the Word
 * toolchain isn't installed.
 *
 * Usage:
 *   node build_html.js <data.json> [output.html]     # stdout if no output path
 *
 * THE ONE DIFFERENCE FROM THE .DOCX: this output carries the machine-readable
 * recap tags (DECIDED / OUTSTANDING / NEXT MEETING) and the .docx never does.
 * The website parses those tags on save, mints Butler Ghost's board recap draft
 * from them, and REMOVES them from the stored minutes — so they are a delivery
 * mechanism, not content. Keeping them out of the .docx keeps the formal
 * document that goes to the board free of machinery it should never show.
 */

// ---------------------------------------------------------------------------
// HTML emitter — the website's minutes format
// ---------------------------------------------------------------------------
//
// Markup conventions were taken from the minutes already stored by the site,
// not invented here: sections are <h1><strong>, items <h2><strong> with the
// number followed by eight &nbsp; then the title, sub-items <h3><strong> with a
// plain space, bullets <ul><li><p>, motions a <blockquote> whose first line is
// <u>-underlined, and ACTION lines <p><strong>ACTION:</strong>&nbsp; text</p>.
// Matching them means a paste lands looking like every previous set of minutes.

const NB8 = "&nbsp;".repeat(8);

function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function blocksToHtml(blocks) {
  const out = [];
  let openList = false;

  const closeList = () => {
    if (openList) { out.push("</ul>"); openList = false; }
  };

  (blocks || []).forEach((b) => {
    if (b.type !== "bullet") closeList();

    switch (b.type) {
      case "sectionHeading":
        out.push(`<h1><strong>${esc(b.text)}</strong></h1>`);
        break;
      case "item":
        out.push(`<h2><strong>${esc(b.num)}.${NB8} ${esc(b.title)}</strong></h2>`);
        break;
      case "subitem":
        out.push(`<h3><strong>${esc(b.num)} ${esc(b.title)}</strong></h3>`);
        break;
      case "body":
        out.push(`<p>${esc(b.text)}</p>`);
        break;
      case "bullet":
        if (!openList) { out.push("<ul>"); openList = true; }
        out.push(`<li><p>${esc(b.text)}</p></li>`);
        break;
      case "motion":
        out.push("<blockquote>");
        (b.lines || []).forEach((l) => {
          const inner = l.underline ? `<u>${esc(l.text)}</u>` : esc(l.text);
          out.push(`<p>${l.bold ? `<strong>${inner}</strong>` : inner}</p>`);
        });
        out.push("</blockquote>");
        break;
      case "action":
        out.push(`<p><strong>${esc(b.label || "ACTION")}:</strong>&nbsp; ${esc(b.text)}</p>`);
        break;
      default:
        throw new Error(`Unknown block type: ${b.type}`);
    }
  });

  closeList();
  return out.join("");
}

/**
 * The machine-readable tail.
 *
 * Plain <p> lines with NO heading above them, deliberately. The website removes
 * each tagged paragraph on save; a heading is ordinary minutes content, would
 * survive the removal, and would leave an empty section behind in the record.
 */
function recapTagsToHtml(recap) {
  if (!recap) return "";
  const line = (tag, text) => `<p>${tag}: ${esc(text)}</p>`;
  return [
    ...(recap.decided || []).map((t) => line("DECIDED", t)),
    ...(recap.outstanding || []).map((t) => line("OUTSTANDING", t)),
    ...(recap.nextMeeting || []).map((t) => line("NEXT MEETING", t)),
  ].join("");
}

function buildHtml(data) {
  const head = [
    `<h1><strong>${esc(data.meetingTitle || "CSC Board Meeting")}</strong></h1>`,
    `<p><strong>${esc(data.meetingDateLong || "")}</strong></p>`,
    `<p><strong>Present:</strong>&nbsp; ${(data.present || []).filter(Boolean).map(esc).join("; ")}</p>`,
    `<p><strong>Absent:</strong>&nbsp; ${(data.absent || []).filter(Boolean).map(esc).join("; ")}</p>`,
  ].join("");

  return head + blocksToHtml(data.blocks) + recapTagsToHtml(data.recap);
}


module.exports = { buildHtml, blocksToHtml, recapTagsToHtml, esc };

// CLI
if (require.main === module) {
  const fs = require("fs");
  const [, , dataPath, outPath] = process.argv;
  if (!dataPath) {
    console.error("Usage: node build_html.js <data.json> [output.html]");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const html = buildHtml(data);
  if (outPath) {
    fs.writeFileSync(outPath, html);
    console.error("Wrote " + outPath);
  } else {
    process.stdout.write(html);
  }
}
