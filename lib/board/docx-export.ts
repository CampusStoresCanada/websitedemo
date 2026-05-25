/**
 * Board meeting DOCX export + OneDrive push.
 *
 * Converts the TipTap HTML content for agenda/minutes to DOCX,
 * then uploads to OneDrive under:
 *   Board Meetings/YYYY/YYYY-MM-DD/Agenda - YYYY-MM-DD.docx
 *   Board Meetings/YYYY/YYYY-MM-DD/Minutes - YYYY-MM-DD.docx
 *
 * OneDrive upload uses the Graph API multipart PUT (files up to 4 MB)
 * or the upload session for larger files. Board documents are tiny,
 * so simple PUT is fine.
 */

// html-to-docx is CommonJS; dynamic import avoids ESM issues
// eslint-disable-next-line @typescript-eslint/no-require-imports
const HTMLtoDOCX = require("html-to-docx") as (
  html: string,
  headerHtml: string | null,
  options: Record<string, unknown>
) => Promise<Buffer>;

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ─── Graph token (re-use the onedrive client config) ─────────────────────────

async function getGraphToken(): Promise<string> {
  const tenantId     = process.env.CSC_BOARD_PORTAL_DIRECTORY;
  const clientId     = process.env.CSC_BOARD_PORTAL_APPLICATION;
  const clientSecret = process.env.CSC_BOARD_PORTAL_VALUE;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Missing Entra ID config for OneDrive push");
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );

  if (!res.ok) throw new Error(`Entra token failed (${res.status})`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

// ─── HTML → DOCX ─────────────────────────────────────────────────────────────

const DOCX_OPTIONS = {
  orientation:   "portrait",
  margins:       { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1 inch = 1440 twips
  fontSize:      24,                 // 12pt (half-points)
  title:         "CSC Board Meeting",
  creator:       "Campus Stores Canada",
};

export async function htmlToDocxBuffer(html: string): Promise<Buffer> {
  // html-to-docx needs a full HTML document wrapper
  const wrapped = `
    <html>
      <head>
        <style>
          body { font-family: Calibri, Arial, sans-serif; font-size: 12pt; }
          h1   { font-size: 18pt; color: #163D6D; }
          h2   { font-size: 15pt; color: #163D6D; }
          h3   { font-size: 13pt; }
          ul, ol { padding-left: 24pt; }
          li   { margin-bottom: 4pt; }
          p    { margin: 0 0 8pt; }
        </style>
      </head>
      <body>${html}</body>
    </html>
  `;

  return HTMLtoDOCX(wrapped, null, DOCX_OPTIONS) as Promise<Buffer>;
}

// ─── OneDrive push ────────────────────────────────────────────────────────────

/**
 * Upload a buffer to OneDrive via simple PUT (≤4 MB).
 * Path is relative to the drive root, e.g.:
 *   "Board Meetings/2026/2026-01-15/Agenda - 2026-01-15.docx"
 */
async function uploadToOneDrive(
  driveId: string,
  remotePath: string,
  buffer: Buffer,
  mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
): Promise<void> {
  const token       = await getGraphToken();
  const encodedPath = remotePath.split("/").map(encodeURIComponent).join("/");
  const url         = `${GRAPH_BASE}/drives/${driveId}/root:/${encodedPath}:/content`;

  const res = await fetch(url, {
    method:  "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType,
    },
    body: new Uint8Array(buffer),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OneDrive PUT failed (${res.status}): ${text}`);
  }
}

// ─── Public export function ───────────────────────────────────────────────────

export interface MeetingExportInput {
  meetingId:   string;
  meetingDate: string;      // YYYY-MM-DD
  agendaHtml:  string | null;
  minutesHtml: string | null;
}

export interface ExportResult {
  meetingId:    string;
  meetingDate:  string;
  agendaExported:  boolean;
  minutesExported: boolean;
  errors:          string[];
}

export async function exportMeetingToOneDrive(
  meeting: MeetingExportInput,
  driveId: string,
  boardFolder: string = "Board Meetings"
): Promise<ExportResult> {
  const { meetingId, meetingDate, agendaHtml, minutesHtml } = meeting;
  const year   = meetingDate.slice(0, 4);
  const result: ExportResult = {
    meetingId,
    meetingDate,
    agendaExported:  false,
    minutesExported: false,
    errors:          [],
  };

  const docs: Array<{ type: "agenda" | "minutes"; html: string; filename: string }> = [];

  if (agendaHtml) {
    docs.push({
      type:     "agenda",
      html:     agendaHtml,
      filename: `Agenda - ${meetingDate}.docx`,
    });
  }

  if (minutesHtml) {
    docs.push({
      type:     "minutes",
      html:     minutesHtml,
      filename: `Minutes - ${meetingDate}.docx`,
    });
  }

  for (const doc of docs) {
    try {
      const buffer     = await htmlToDocxBuffer(doc.html);
      const remotePath = `${boardFolder}/${year}/${meetingDate}/${doc.filename}`;
      await uploadToOneDrive(driveId, remotePath, buffer);

      if (doc.type === "agenda")  result.agendaExported  = true;
      if (doc.type === "minutes") result.minutesExported = true;
    } catch (err) {
      result.errors.push(`${doc.type}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
