/**
 * The members' agenda for the annual general meeting.
 *
 * Derived from the AGM script's blocks rather than written separately. The
 * script is already the running order — it exists because the chair needs to
 * know what happens next — and a second hand-maintained list would drift from
 * it the first time an item moved. One order, two renderings: the script is
 * what the chair reads, the agenda is what members receive.
 *
 * The pre-meeting housekeeping block is dropped. It is genuinely pre-meeting
 * (waiting room, muting, how to be recognised) and putting it on the agenda
 * implies it is business of the meeting, which it is not.
 *
 * Times are listed across every Canadian zone, for the same reason the script
 * does it: a national membership joining one call has been the source of more
 * confusion than any other line in the notice.
 *
 * Pure. Callers supply the script and the facts.
 */

export interface AgendaBlock {
  number: number | null;
  heading: string;
  speaker: string | null;
}

export interface AgmAgendaInput {
  cycleYear: number;
  agmDate: string;
  /** Blocks from buildAgmScript, in order. */
  blocks: AgendaBlock[];
  /** Local start and end times, in the association's usual order. */
  times: { label: string; start: string; end: string }[];
  /** Where the meeting is held, when there is a link. */
  meetingUrl: string | null;
}

export interface AgmAgendaItem {
  number: number | null;
  heading: string;
  speaker: string | null;
}

export interface AgmAgenda {
  title: string;
  items: AgmAgendaItem[];
  html: string;
}

/** Blocks that are not business of the meeting and do not belong on the agenda. */
const NOT_MEETING_BUSINESS = ["Introductions and pre-meeting housekeeping"];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function buildAgmAgenda(input: AgmAgendaInput): AgmAgenda {
  const items: AgmAgendaItem[] = input.blocks
    .filter((b) => !NOT_MEETING_BUSINESS.includes(b.heading))
    .map((b) => ({ number: b.number, heading: b.heading, speaker: b.speaker }));

  const title = `${input.cycleYear} Annual General Meeting — Agenda`;

  const timesHtml = input.times.length
    ? `<p><strong>Starts at</strong></p>\n<ul>\n${input.times
        .map(
          (t) =>
            `  <li>${escapeHtml(t.label)} — ${escapeHtml(t.start)} to ${escapeHtml(t.end)}</li>`
        )
        .join("\n")}\n</ul>`
    : "";

  const whereHtml = input.meetingUrl
    ? `<p><strong>Where</strong> — <a href="${escapeHtml(input.meetingUrl)}">${escapeHtml(
        input.meetingUrl
      )}</a></p>`
    : "";

  // Numbered items keep their number; the unnumbered ones (the installation of
  // the incoming board) are real business and stay in place, just without one.
  const itemsHtml = items
    .map((i) => {
      const label = i.number === null ? "" : `${i.number}. `;
      const who = i.speaker ? ` <span style="color:#6b7280">— ${escapeHtml(i.speaker)}</span>` : "";
      return `  <li>${label}${escapeHtml(i.heading)}${who}</li>`;
    })
    .join("\n");

  const html = [
    `<h2>${escapeHtml(title)}</h2>`,
    `<p><strong>${escapeHtml(longDate(input.agmDate))}</strong></p>`,
    timesHtml,
    whereHtml,
    `<ol style="list-style:none;padding-left:0">`,
    itemsHtml,
    `</ol>`,
  ]
    .filter(Boolean)
    .join("\n");

  return { title, items, html };
}
