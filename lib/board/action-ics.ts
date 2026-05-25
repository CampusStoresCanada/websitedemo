/**
 * Shared VTODO .ics builder for board action items.
 * Used by both the /api/board/action/[token]/ics route
 * and the email notification helper.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";

export interface ActionIcsParams {
  id:            string;
  title:         string;
  description:   string | null;
  dueDate:       string | null;   // YYYY-MM-DD
  status:        string;
  completeToken: string;
  createdAt:     string;          // Supabase timestamptz (may lack Z)
}

export function buildActionIcs(params: ActionIcsParams): string {
  const { id, title, description, dueDate, status, completeToken, createdAt } = params;

  const completeUrl     = `${APP_URL}/api/board/action/${completeToken}`;
  const uid             = `action-${id}@campusstores.ca`;
  const now             = formatIcsDateTime(new Date());
  const descriptionText = [description, `Mark complete: ${completeUrl}`].filter(Boolean).join("\n\n");

  // Normalize Supabase timestamptz — comes as "2026-05-25 10:00:00", no Z
  const raw    = createdAt;
  const normed = raw.endsWith("Z") || raw.includes("+") ? raw : raw.replace(" ", "T") + "Z";
  const created = formatIcsDateTime(new Date(normed));

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Campus Stores Canada//Board Portal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTODO",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `CREATED:${created}`,
    `SUMMARY:${escapeIcs(title)}`,
    `DESCRIPTION:${escapeIcs(descriptionText)}`,
    `URL:${completeUrl}`,
    `STATUS:${status === "complete" ? "COMPLETED" : "NEEDS-ACTION"}`,
    `PERCENT-COMPLETE:${status === "complete" ? "100" : "0"}`,
    `PRIORITY:5`,
    `CLASS:PUBLIC`,
  ];

  if (dueDate) {
    const dateStr = dueDate.replace(/-/g, "");
    lines.push(`DTSTART;VALUE=DATE:${dateStr}`);
    lines.push(`DUE;VALUE=DATE:${dateStr}`);
  }

  lines.push("END:VTODO", "END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function formatIcsDateTime(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}
