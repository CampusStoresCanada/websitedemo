/**
 * OneDrive → Supabase board document sync
 *
 * Folder convention the ED already uses:
 *   Board Meetings/
 *     [YYYY]/
 *       [YYYY-MM-DD]/
 *         agenda.pdf
 *         financials.pdf
 *         minutes.pdf
 *         ...
 *
 * The sync:
 * 1. Fetches delta from Graph API (only changed items since last run)
 * 2. Parses folder path → meeting date
 * 3. Downloads new/changed files → Supabase Storage
 * 4. Upserts board_meetings and board_documents records
 * 5. Saves the new delta token back to app_settings
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchDelta, downloadFile, type GraphDriveItem } from "./client";

// ─── Config ──────────────────────────────────────────────────────

const BOARD_FOLDER = "Board Meetings"; // matches app_settings default

/** Infer document_type from filename */
function inferDocumentType(
  filename: string
): "agenda" | "minutes" | "financials" | "other" {
  const lower = filename.toLowerCase();
  if (lower.includes("agenda"))                          return "agenda";
  if (lower.includes("minute") || lower.includes("minutes")) return "minutes";
  if (
    lower.includes("financial") ||
    lower.includes("finance") ||
    lower.includes("budget") ||
    lower.includes("p&l") ||
    lower.includes("income") ||
    lower.includes("balance")
  )                                                      return "financials";
  return "other";
}

/**
 * Parse a Graph item path into { year, meetingDate } or null if not
 * under a recognisable Board Meetings/YYYY/YYYY-MM-DD/ structure.
 *
 * Graph paths look like:
 *   /drives/{driveId}/root:/Board Meetings/2026/2026-01-15
 */
function parseMeetingPath(
  item: GraphDriveItem
): { year: number; meetingDate: string } | null {
  const raw  = item.parentReference.path ?? "";
  // Normalise: decode and strip everything up to and including the folder root
  const decoded = decodeURIComponent(raw);

  // Find the Board Meetings segment
  const marker  = BOARD_FOLDER + "/";
  const idx     = decoded.indexOf(marker);
  if (idx === -1) return null;

  const after   = decoded.slice(idx + marker.length); // e.g. "2026/2026-01-15"
  const parts   = after.split("/").filter(Boolean);

  if (parts.length < 2) return null;

  const year        = parseInt(parts[0], 10);
  const meetingDate = parts[1]; // expect YYYY-MM-DD

  if (isNaN(year) || !/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) return null;

  return { year, meetingDate };
}

// ─── Main sync function ───────────────────────────────────────────

export interface SyncResult {
  added:   number;
  updated: number;
  skipped: number;
  errors:  string[];
}

export async function syncOneDriveDocuments(): Promise<SyncResult> {
  const db     = createAdminClient();
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, errors: [] };

  // Load config from app_settings
  const { data: settings } = await db
    .from("app_settings")
    .select("key, value")
    .in("key", ["onedrive_delta_token", "onedrive_drive_id", "onedrive_board_folder_path"]);

  const settingsMap: Record<string, string> = {};
  for (const row of settings ?? []) {
    settingsMap[row.key] = row.value ?? "";
  }

  const driveId    = settingsMap["onedrive_drive_id"];
  const deltaToken = settingsMap["onedrive_delta_token"] || null;
  const folderPath = settingsMap["onedrive_board_folder_path"] || BOARD_FOLDER;

  if (!driveId) {
    throw new Error(
      "onedrive_drive_id not configured in app_settings. " +
      "Run the drive discovery setup first."
    );
  }

  // Fetch delta
  const { items, nextDeltaToken } = await fetchDelta(driveId, folderPath, deltaToken);

  // Only process files (skip folder entries)
  const files = items.filter((item) => item.file);

  for (const item of files) {
    try {
      const parsed = parseMeetingPath(item);
      if (!parsed) {
        result.skipped++;
        continue;
      }

      const { meetingDate } = parsed;

      // Upsert board_meeting for this date
      const { data: meeting, error: meetingError } = await db
        .from("board_meetings")
        .upsert(
          {
            title:        `Board Meeting — ${meetingDate}`,
            meeting_type: "regular",
            meeting_date: meetingDate,
            status:       "upcoming",
          },
          { onConflict: "meeting_date", ignoreDuplicates: false }
        )
        .select("id, status")
        .single();

      if (meetingError || !meeting) {
        result.errors.push(`Meeting upsert failed for ${meetingDate}: ${meetingError?.message}`);
        continue;
      }

      // Check if we already have this exact OneDrive item
      const { data: existing } = await db
        .from("board_documents")
        .select("id, updated_at")
        .eq("onedrive_item_id", item.id)
        .maybeSingle();

      const lastModified = new Date(item.lastModifiedDateTime).toISOString();

      if (existing) {
        // Skip if OneDrive hasn't changed since our last sync
        const existingTs = new Date(existing.updated_at).getTime();
        const remoteTs   = new Date(lastModified).getTime();
        if (remoteTs <= existingTs) {
          result.skipped++;
          continue;
        }
      }

      // Download file
      const buffer   = await downloadFile(driveId, item.id);
      const bytes    = Buffer.from(buffer);
      const mimeType = item.file?.mimeType ?? "application/octet-stream";

      // Storage path: board-documents/YYYY-MM-DD/filename
      const storagePath = `${meetingDate}/${item.name}`;

      const { error: uploadError } = await db.storage
        .from("board-documents")
        .upload(storagePath, bytes, {
          contentType:  mimeType,
          upsert:       true,
        });

      if (uploadError) {
        result.errors.push(`Storage upload failed for ${item.name}: ${uploadError.message}`);
        continue;
      }

      // Upsert board_document record
      const docType = inferDocumentType(item.name);

      const { error: docError } = await db.from("board_documents").upsert(
        {
          ...(existing ? { id: existing.id } : {}),
          meeting_id:       meeting.id,
          title:            item.name.replace(/\.[^.]+$/, ""), // strip extension
          document_type:    docType,
          context:          "meeting",
          storage_path:     storagePath,
          onedrive_item_id: item.id,
          onedrive_path:    item.parentReference.path,
          file_size_bytes:  item.size,
          mime_type:        mimeType,
        },
        { onConflict: "onedrive_item_id", ignoreDuplicates: false }
      );

      if (docError) {
        result.errors.push(`Document upsert failed for ${item.name}: ${docError.message}`);
        continue;
      }

      existing ? result.updated++ : result.added++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Error processing ${item.name}: ${msg}`);
    }
  }

  // Save the new delta token so next run only fetches changes
  if (nextDeltaToken) {
    await db
      .from("app_settings")
      .update({ value: nextDeltaToken })
      .eq("key", "onedrive_delta_token");
  }

  return result;
}

// ─── Secret expiry check ──────────────────────────────────────────

/**
 * Returns how many days until the Entra ID client secret expires.
 * Reads from env (CSC_BOARD_PORTAL_EXPIRY) — YYYYMMDD format.
 * Returns null if not configured.
 */
export function daysUntilSecretExpiry(): number | null {
  const raw = process.env.CSC_BOARD_PORTAL_EXPIRY;
  if (!raw || raw.length !== 8) return null;

  const year  = parseInt(raw.slice(0, 4), 10);
  const month = parseInt(raw.slice(4, 6), 10) - 1; // 0-indexed
  const day   = parseInt(raw.slice(6, 8), 10);

  const expiry = new Date(Date.UTC(year, month, day));
  const now    = new Date();
  now.setUTCHours(0, 0, 0, 0);

  const diffMs   = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return diffDays;
}
