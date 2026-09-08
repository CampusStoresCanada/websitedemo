/**
 * Builds a CSC Board Meeting minutes .docx from a JSON content spec, matching
 * the established CSC minutes letterhead/format exactly (logo, Present/Absent
 * block, blue BUSINESS ITEMS / DISCUSSION ITEMS / OTHER BUSINESS headers,
 * boxed motion language, ACTION items, footer rule).
 *
 * Also emits a companion .html alongside the .docx, matching the markup the
 * CSC website's minutes editor stores, so the minutes can go straight into the
 * site with no hand conversion. The two outputs differ in exactly one respect:
 * the HTML carries the machine-readable recap tags (DECIDED / OUTSTANDING /
 * NEXT MEETING) and the .docx never does. Those tags exist only to be parsed
 * and removed by the website on save — they are not part of the minutes, so
 * they must not reach the formal document that goes to the board.
 *
 * Usage:
 *   node build_minutes.js <data.json> <output.docx> [path/to/logo.jpeg]
 *
 * Writes <output>.docx and <output>.html.
 *
 * See references/data_schema.md for the JSON shape, or scripts/example_data.json
 * for a worked example.
 */
const fs = require("fs");
const path = require("path");
const { buildHtml } = require("./build_html");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType, TabStopType, TabStopPosition,
  Footer,
} = require("docx");

const BLUE = "1F5C99";
const FONT = "Times New Roman";

const [, , dataPath, outPath, logoPathArg] = process.argv;
if (!dataPath || !outPath) {
  console.error("Usage: node build_minutes.js <data.json> <output.docx> [logo.jpeg]");
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const logoPath = logoPathArg || path.join(__dirname, "..", "assets", "csc_logo.jpeg");

function P(opts) {
  return new Paragraph(opts);
}
function run(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: 22, ...opts });
}

// A bordered 1x1 table containing centered lines — used for formal motion language.
function motionBox(lines) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: lines.map((l) =>
              P({
                alignment: AlignmentType.CENTER,
                spacing: { after: 40 },
                children: [run(l.text, { underline: l.underline ? {} : undefined, bold: !!l.bold })],
              })
            ),
          }),
        ],
      }),
    ],
  });
}

function sectionHeading(text) {
  return P({
    spacing: { before: 200, after: 100 },
    children: [run(text, { bold: true, color: BLUE, size: 24 })],
  });
}

function itemHeading(num, title) {
  return P({
    spacing: { before: 200, after: 80 },
    tabStops: [{ type: TabStopType.LEFT, position: 720 }],
    children: [run(`${num}.\t`, { bold: true }), run(title, { bold: true })],
  });
}

function subHeading(num, title) {
  return P({
    indent: { left: 720 },
    spacing: { before: 160, after: 60 },
    tabStops: [{ type: TabStopType.LEFT, position: 1080 }],
    children: [run(`${num}\t`, { bold: true }), run(title, { bold: true })],
  });
}

function body(text, indent = 720) {
  return P({ indent: { left: indent }, spacing: { after: 120 }, children: [run(text)] });
}

function bullet(text, indent = 1080) {
  return P({
    indent: { left: indent, hanging: 260 },
    spacing: { after: 80 },
    children: [run("•  "), run(text)],
  });
}

function actionItem(label, text, indent = 0) {
  return P({
    indent: { left: indent + 1080, hanging: 1080 },
    spacing: { before: 120, after: 120 },
    children: [run(`${label}:`, { bold: true }), run("\t" + text)],
  });
}

// Present/Absent block. `names` is a single comma-separated string (or array of
// strings/blank-line markers) — Word/LibreOffice wraps it naturally under the
// hanging indent, so don't hand-split lines yourself.
function presentAbsentBlock(label, entries) {
  const paras = [];
  entries.forEach((entry, i) => {
    paras.push(
      P({
        indent: { left: 1980, hanging: 1980 },
        spacing: { after: i === entries.length - 1 ? 200 : 0 },
        children: i === 0
          ? [run(`${label}:`, { bold: true }), run("\t" + entry)]
          : [run("\t" + (entry || " "))],
      })
    );
  });
  return paras;
}

const children = [];

// ---- Letterhead ----
const logo = fs.readFileSync(logoPath);
children.push(
  P({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new ImageRun({ data: logo, transformation: { width: 130, height: 95 }, type: "jpg" })],
  })
);
children.push(P({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [run(data.meetingTitle || "CSC Board Meeting", { size: 40 })] }));
children.push(P({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [run(data.meetingDateLong, { size: 24 })] }));
children.push(
  P({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 8 } },
    children: [run(" ")],
  })
);
children.push(P({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [run("Minutes", { size: 32 })] }));

// ---- Present / Absent ----
children.push(...presentAbsentBlock("Present", data.present));
children.push(...presentAbsentBlock("Absent", data.absent));

// ---- Body blocks ----
(data.blocks || []).forEach((b) => {
  switch (b.type) {
    case "sectionHeading":
      children.push(sectionHeading(b.text));
      break;
    case "item":
      children.push(itemHeading(b.num, b.title));
      break;
    case "subitem":
      children.push(subHeading(b.num, b.title));
      break;
    case "body":
      children.push(body(b.text, b.indent ?? 720));
      break;
    case "bullet":
      children.push(bullet(b.text, b.indent ?? 1080));
      break;
    case "motion":
      children.push(motionBox(b.lines));
      break;
    case "action":
      children.push(actionItem(b.label || "ACTION", b.text, b.indent ?? 0));
      break;
    default:
      throw new Error(`Unknown block type: ${b.type}`);
  }
});


// ---- Footer ----
const footer = new Footer({
  children: [
    P({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: "000000", space: 4 } },
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      children: [run("CSC Board of Directors Meeting – Minutes", { size: 18 }), run("\t" + data.footerDate, { size: 18 })],
    }),
  ],
});

const doc = new Document({
  sections: [
    {
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } },
      },
      footers: { default: footer },
      children,
    },
  ],
});

const htmlPath = outPath.replace(/\.docx$/i, "") + ".html";

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  fs.writeFileSync(htmlPath, buildHtml(data));

  const r = data.recap || {};
  const counts = {
    decided: (r.decided || []).length,
    outstanding: (r.outstanding || []).length,
    nextMeeting: (r.nextMeeting || []).length,
  };
  const total = counts.decided + counts.outstanding + counts.nextMeeting;

  console.log("Wrote " + outPath + "   (formal minutes — no recap tags)");
  console.log("Wrote " + htmlPath + "   (paste into the website)");
  if (total > 0) {
    console.log(
      `Recap tags in the HTML only: ${total} ` +
      `(${counts.decided} decided, ${counts.outstanding} outstanding, ${counts.nextMeeting} next meeting)`
    );
  } else {
    console.log(
      "No recap tags emitted — add a \"recap\" block to data.json or the website " +
      "will draft no board recap for this meeting."
    );
  }
});
