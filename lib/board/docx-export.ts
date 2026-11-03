/**
 * Board meeting DOCX export + OneDrive push.
 *
 * Converts the TipTap HTML content for agenda/minutes to DOCX and files it:
 *   Minutes → OneDrive  Documents/CSC/Board/Minutes/<board year>/
 *                       Minutes - CSC Board Minutes - YYYY-MM-DD.docx
 *             website   the meeting's Documents panel (board_documents)
 *   Agenda  → OneDrive  Board Meetings/YYYY/YYYY-MM-DD/Agenda - YYYY-MM-DD.docx
 *
 * The minutes folder is overridable with app_settings
 * `onedrive_minutes_folder_path`; the agenda uses `onedrive_board_folder_path`.
 *
 * Minutes go through the csc-board-minutes skill's own `build_minutes.js` —
 * the CSC letterhead, the same builder a CoWork session uses — after the stored
 * HTML is read back into its data.json shape. Imported statically for the same
 * reason minutes-render.ts imports build_html.js: a runtime require of a skills/
 * path fails the production build.
 *
 * OneDrive upload uses the Graph API multipart PUT (files up to 4 MB)
 * or the upload session for larger files. Board documents are tiny,
 * so simple PUT is fine.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import * as buildMinutesModule from "../../skills/csc-board-minutes/scripts/build_minutes.js";
import { parseMinutesHtml } from "@/lib/board/minutes-parse";
import { removeGeneratedBoardDocuments, storeBoardDocument } from "@/lib/board/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MinutesData } from "@/lib/board/minutes-schema";

interface BuildMinutesModule {
  buildMinutesDocx: (data: MinutesData, logo: Buffer) => Promise<Buffer>;
}

export async function minutesHtmlToDocxBuffer(html: string): Promise<Buffer> {
  const mod = buildMinutesModule as unknown as BuildMinutesModule & { default?: BuildMinutesModule };
  const build = mod.buildMinutesDocx ?? mod.default?.buildMinutesDocx;
  if (typeof build !== "function") {
    throw new Error("build_minutes.js did not export buildMinutesDocx");
  }
  const logo = await readFile(path.join(process.cwd(), "skills/csc-board-minutes/assets/csc_logo.jpeg"));
  return build(parseMinutesHtml(html), logo);
}

type HtmlToDocx = (
  html: string,
  headerHtml: string | null,
  options: Record<string, unknown>
) => Promise<Buffer>;

// html-to-docx ships a UMD build (main) and an ESM build (module) whose only
// export is `default`. Node's require gets the function; the Next bundler picks
// the ESM build and require returns `{ default: fn }`. Calling that object threw
// "i is not a function" on every monthly export, so unwrap either shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const htmlToDocxModule = require("html-to-docx") as HtmlToDocx | { default: HtmlToDocx };
const HTMLtoDOCX: HtmlToDocx =
  typeof htmlToDocxModule === "function" ? htmlToDocxModule : htmlToDocxModule.default;

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
): Promise<{ itemId: string; path: string }> {
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

  const item = await res.json() as { id: string; parentReference?: { path?: string } };
  return { itemId: item.id, path: item.parentReference?.path ?? remotePath };
}


// ─── Where minutes are filed ─────────────────────────────────────────────────

/** The minutes archive in the ED's OneDrive, which syncs to the office machine. */
const DEFAULT_MINUTES_FOLDER = "Documents/CSC/Board/Minutes";

/** The file name every set of minutes in that archive already uses. */
export function minutesTitle(meetingDate: string): string {
  return `Minutes - CSC Board Minutes - ${meetingDate}`;
}

/**
 * The board-year folder, e.g. "2026-27". A board year runs from one AGM to the
 * next, so a meeting belongs to the year of the latest AGM on or before it.
 * With no AGM on record that early, falls back to a February 1 boundary
 * (AGMs are held in January).
 */
export function boardYearFolder(meetingDate: string, agmDates: string[]): string {
  const agm = agmDates.filter((d) => d <= meetingDate).sort().at(-1);
  const year = agm
    ? Number(agm.slice(0, 4))
    : Number(meetingDate.slice(0, 4)) - (meetingDate.slice(5, 7) === "01" ? 1 : 0);
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

// ─── Public export function ───────────────────────────────────────────────────

export interface ExportResult {
  meetingId:       string;
  meetingDate:     string;
  agendaExported:  boolean;
  minutesExported: boolean;  // to OneDrive
  minutesAttached: boolean;  // to the meeting's documents on the website
  errors:          string[];
}

/**
 * File a meeting's documents. Minutes go to the board-year folder of the
 * minutes archive in OneDrive AND onto the meeting's Documents panel on the
 * website; neither depends on the other succeeding. The agenda keeps its
 * original OneDrive-only path.
 *
 * Called by "Mark completed" and by the monthly cron as a catch-up. Safe to run
 * twice: OneDrive overwrites by path, and the website copy replaces the
 * previous generated one.
 */
export async function exportBoardMeeting(meetingId: string): Promise<ExportResult> {
  const db = createAdminClient();

  const [{ data: meeting }, { data: settings }, { data: agms }] = await Promise.all([
    db.from("board_meetings")
      .select("id, meeting_date, agenda_html, minutes_html")
      .eq("id", meetingId)
      .maybeSingle(),
    db.from("app_settings")
      .select("key, value")
      .in("key", ["onedrive_drive_id", "onedrive_board_folder_path", "onedrive_minutes_folder_path"]),
    db.from("board_meetings")
      .select("meeting_date")
      .eq("meeting_type", "agm")
      .neq("status", "cancelled"),
  ]);

  if (!meeting) throw new Error(`Board meeting ${meetingId} not found`);

  const setting: Record<string, string> = {};
  for (const row of settings ?? []) setting[row.key] = row.value ?? "";
  const driveId       = setting["onedrive_drive_id"];
  const boardFolder   = setting["onedrive_board_folder_path"] || "Board Meetings";
  const minutesFolder = setting["onedrive_minutes_folder_path"] || DEFAULT_MINUTES_FOLDER;

  const meetingDate = meeting.meeting_date;
  const result: ExportResult = {
    meetingId,
    meetingDate,
    agendaExported:  false,
    minutesExported: false,
    minutesAttached: false,
    errors:          [],
  };

  if (meeting.agenda_html && driveId) {
    try {
      const buffer = await htmlToDocxBuffer(meeting.agenda_html);
      const year   = meetingDate.slice(0, 4);
      await uploadToOneDrive(driveId, `${boardFolder}/${year}/${meetingDate}/Agenda - ${meetingDate}.docx`, buffer);
      result.agendaExported = true;
    } catch (err) {
      result.errors.push(`agenda: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!meeting.minutes_html) return result;

  let buffer: Buffer;
  try {
    buffer = await minutesHtmlToDocxBuffer(meeting.minutes_html);
  } catch (err) {
    result.errors.push(`minutes: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const title    = minutesTitle(meetingDate);
  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  let onedrive: { itemId: string; path: string } | null = null;

  if (driveId) {
    const folder = boardYearFolder(meetingDate, (agms ?? []).map((a) => a.meeting_date));
    try {
      onedrive = await uploadToOneDrive(driveId, `${minutesFolder}/${folder}/${title}.docx`, buffer, docxMime);
      result.minutesExported = true;
    } catch (err) {
      result.errors.push(`minutes (OneDrive): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await removeGeneratedBoardDocuments(meetingId, "minutes", title);
  const stored = await storeBoardDocument({
    meetingId,
    documentType: "minutes",
    title,
    body:         buffer,
    mimeType:     docxMime,
    sizeBytes:    buffer.length,
    extension:    "docx",
    uploadedBy:   null,
    onedrive,
  });
  if ("error" in stored) result.errors.push(`minutes (website): ${stored.error}`);
  else result.minutesAttached = true;

  return result;
}
