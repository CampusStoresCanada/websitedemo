/**
 * Read stored minutes HTML back into the skill's `data.json` shape.
 *
 * The inverse of `skills/csc-board-minutes/scripts/build_html.js`, and only of
 * that: it recognises the markup that emitter writes (and that every set of
 * minutes in the site already uses) — <h1> sections, <h2> "N.&nbsp;×8 Title"
 * items, <h3> "N.N Title" sub-items, <ul><li><p> bullets, <blockquote> motions,
 * and <p><strong>ACTION:</strong> lines.
 *
 * Why it exists: `minutes_html` is the approved record. The `data_json` on a
 * draft job is the model's first pass, before anyone edited it, and minutes that
 * were pasted in by hand have no draft at all. So the formal .docx has to be
 * built from the HTML, and the HTML has lost two things the .docx needs:
 *
 *  - indents, which build_html.js drops. They are restored from the skill's own
 *    convention (example_data.json): deeper under a sub-item, default otherwise.
 *  - the blank spacer between board members and staff in Present, which the
 *    emitter filters out when it joins entries with "; ". (Absent has none in
 *    the skill's example, so none is restored there.)
 *
 * Stored minutes carry "@Full Name" mentions for the website to resolve. Those
 * are stripped to plain names: the .docx is a document, not a mention surface.
 */

import type { MinutesData } from "@/lib/board/minutes-schema";

type Block = Record<string, unknown>;

const RECAP_TAG = /^(DECIDED|OUTSTANDING|NEXT MEETING):/;

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "’")
    .replace(/&amp;/g, "&")
    .replace(/@(?=\p{Lu})/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Thursday, September 24, 2026" → "September 24, 2026" */
function footerDateOf(longDate: string): string {
  return longDate.replace(/^[A-Za-z]+,\s*/, "");
}

/** Board members first, then a blank spacer, then staff — as the .docx lays out Present. */
function withStaffSpacer(entries: string[]): string[] {
  return entries.length > 1 ? [entries[0], "", ...entries.slice(1)] : entries;
}

export function parseMinutesHtml(html: string): MinutesData {
  const data: MinutesData = {
    meetingTitle: "CSC Board Meeting",
    meetingDateLong: "",
    footerDate: "",
    present: [],
    absent: [],
    blocks: [],
    recap: { decided: [], outstanding: [], nextMeeting: [] },
    assumptions: [],
  };

  const blocks: Block[] = data.blocks;
  let underSubitem = false;
  let sawTitle = false;

  const el = /<(h1|h2|h3|p|ul|ol|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/g;
  for (const [, tag, inner] of html.matchAll(el)) {
    const t = text(inner);
    if (!t) continue;

    switch (tag) {
      case "h1":
        if (!sawTitle && blocks.length === 0 && !data.meetingDateLong) {
          data.meetingTitle = t;
          sawTitle = true;
        } else {
          blocks.push({ type: "sectionHeading", text: t });
          underSubitem = false;
        }
        break;

      case "h2": {
        const m = t.match(/^(\d+)\.?\s*(.*)$/);
        blocks.push({ type: "item", num: m?.[1] ?? "", title: m?.[2] ?? t });
        underSubitem = false;
        break;
      }

      case "h3": {
        const m = t.match(/^(\d+\.\d+)\s*(.*)$/);
        blocks.push({ type: "subitem", num: m?.[1] ?? "", title: m?.[2] ?? t });
        underSubitem = true;
        break;
      }

      case "blockquote": {
        const lines = [...inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
          .map(([, p]) => ({
            text: text(p),
            ...(/<u>/.test(p) ? { underline: true } : {}),
            ...(/<strong>/.test(p) ? { bold: true } : {}),
          }))
          .filter((l) => l.text);
        blocks.push({ type: "motion", lines });
        break;
      }

      case "ul":
      case "ol":
        for (const [, li] of inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)) {
          const item = text(li);
          if (item) blocks.push({ type: "bullet", text: item, indent: underSubitem ? 1440 : 1080 });
        }
        break;

      case "p": {
        if (t.startsWith("Present:")) {
          data.present = withStaffSpacer(t.replace(/^Present:\s*/, "").split(/;\s*/).filter(Boolean));
        } else if (t.startsWith("Absent:")) {
          data.absent = t.replace(/^Absent:\s*/, "").split(/;\s*/).filter(Boolean);
        } else if (!data.meetingDateLong && blocks.length === 0) {
          data.meetingDateLong = t;
          data.footerDate = footerDateOf(t);
        } else if (RECAP_TAG.test(t)) {
          // Machinery for the recap post, normally stripped on save. Never minutes content.
        } else {
          const action = t.match(/^(ACTION|MOTION):\s*(.*)$/);
          if (action) {
            blocks.push({ type: "action", label: action[1], text: action[2], indent: underSubitem ? 360 : 0 });
          } else {
            blocks.push({ type: "body", text: t, indent: underSubitem ? 1080 : 720 });
          }
        }
        break;
      }
    }
  }

  return data;
}
