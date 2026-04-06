"use server";

import { createHash } from "crypto";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEventSafe } from "@/lib/ops/audit";
import type { Database } from "@/lib/database.types";

type RegistrationUpdate = Database["public"]["Tables"]["conference_registrations"]["Update"];

export type TravelImportConflictMode = "overwrite" | "fill_empty_only" | "skip_if_existing";
export type TravelImportRowStatus = "success" | "failed" | "skipped";

export type TravelImportRowResult = {
  rowNumber: number;
  status: TravelImportRowStatus;
  code:
    | "ok"
    | "missing_required_field"
    | "conference_mismatch"
    | "unknown_user_or_registration"
    | "invalid_travel_mode"
    | "duplicate_row_in_file"
    | "conflict_skipped_existing"
    | "idempotent_noop"
    | "write_failed";
  message: string;
  registrationId: string | null;
};

type ParsedTravelImportRow = {
  rowNumber: number;
  conference_id: string;
  registration_id: string;
  user_id: string;
  travel_mode: string;
  arrival_flight_number: string;
  arrival_datetime: string;
  arrival_airport: string;
  departure_flight_number: string;
  departure_datetime: string;
  departure_airport: string;
  lodging_property: string;
  room_number: string;
  hotel_confirmation_number: string;
  travel_confirmation_reference: string;
  admin_note: string;
};

const TEMPLATE_HEADERS = [
  "conference_id",
  "registration_id",
  "user_id",
  "travel_mode",
  "arrival_flight_number",
  "arrival_datetime",
  "arrival_airport",
  "departure_flight_number",
  "departure_datetime",
  "departure_airport",
  "lodging_property",
  "room_number",
  "hotel_confirmation_number",
  "travel_confirmation_reference",
  "admin_note",
] as const;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === "\"" && inQuotes && next === "\"") {
      cur += "\"";
      i += 1;
      continue;
    }
    if (ch === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normalizeTravelMode(value: string): "flight" | "road" | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["flight", "air"].includes(normalized)) return "flight";
  if (
    ["road", "rail", "bus", "bus/coach", "personal_vehicle", "personal vehicle", "car", "other"].includes(
      normalized
    )
  ) {
    return "road";
  }
  return null;
}

function buildFlightDetails(params: {
  flightNumber: string;
  airport: string;
  datetime: string;
}): string | null {
  const bits = [params.flightNumber.trim(), params.airport.trim(), params.datetime.trim()].filter(Boolean);
  return bits.length > 0 ? bits.join(" | ") : null;
}

function parseTravelImportCsv(csvText: string): ParsedTravelImportRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const indexByHeader = new Map(headers.map((h, i) => [h, i]));
  const read = (cols: string[], key: string): string => {
    const idx = indexByHeader.get(key);
    if (idx == null || idx < 0 || idx >= cols.length) return "";
    return cols[idx] ?? "";
  };

  const rows: ParsedTravelImportRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    rows.push({
      rowNumber: i + 1,
      conference_id: read(cols, "conference_id"),
      registration_id: read(cols, "registration_id"),
      user_id: read(cols, "user_id"),
      travel_mode: read(cols, "travel_mode"),
      arrival_flight_number: read(cols, "arrival_flight_number"),
      arrival_datetime: read(cols, "arrival_datetime"),
      arrival_airport: read(cols, "arrival_airport"),
      departure_flight_number: read(cols, "departure_flight_number"),
      departure_datetime: read(cols, "departure_datetime"),
      departure_airport: read(cols, "departure_airport"),
      lodging_property: read(cols, "lodging_property"),
      room_number: read(cols, "room_number"),
      hotel_confirmation_number: read(cols, "hotel_confirmation_number"),
      travel_confirmation_reference: read(cols, "travel_confirmation_reference"),
      admin_note: read(cols, "admin_note"),
    });
  }
  return rows;
}

function toCsvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

export async function getTravelImportTemplateCsv(): Promise<string> {
  const sample = [
    "00000000-0000-0000-0000-000000000000",
    "",
    "11111111-1111-1111-1111-111111111111",
    "flight",
    "AC123",
    "2026-05-14T10:15",
    "YYZ",
    "AC456",
    "2026-05-18T16:40",
    "YYZ",
    "Conference Hotel",
    "1408",
    "H123456",
    "PNR123",
    "Imported by ops",
  ];
  return [TEMPLATE_HEADERS.join(","), sample.map(toCsvCell).join(",")].join("\n");
}

export async function importConferenceTravelCsv(input: {
  conferenceId: string;
  csvText: string;
  mode: TravelImportConflictMode;
  dryRun?: boolean;
}): Promise<{
  success: boolean;
  error?: string;
  data?: {
    dryRun: boolean;
    idempotencyKey: string;
    appliedCount: number;
    skippedCount: number;
    failedCount: number;
    rows: TravelImportRowResult[];
  };
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const csvText = input.csvText.trim();
  if (!csvText) return { success: false, error: "CSV input is empty." };

  const rows = parseTravelImportCsv(csvText);
  const fileHash = createHash("sha256").update(csvText).digest("hex");
  const idempotencyKey = `${input.conferenceId}:${input.mode}:${fileHash}`;

  const adminClient = createAdminClient();
  if (!input.dryRun) {
    const duplicateCheck = await adminClient
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "conference_travel_import_applied")
      .eq("entity_type", "conference_instance")
      .eq("entity_id", input.conferenceId)
      .contains("details", { idempotency_key: idempotencyKey });
    if ((duplicateCheck.count ?? 0) > 0) {
      return {
        success: true,
        data: {
          dryRun: false,
          idempotencyKey,
          appliedCount: 0,
          skippedCount: rows.length,
          failedCount: 0,
          rows: rows.map((row) => ({
            rowNumber: row.rowNumber,
            status: "skipped",
            code: "idempotent_noop",
            message: "Import already applied with same file hash + mode.",
            registrationId: row.registration_id || null,
          })),
        },
      };
    }
  }

  const seen = new Set<string>();
  const results: TravelImportRowResult[] = [];
  let appliedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    const duplicateKey = `${row.registration_id}|${row.user_id}|${row.travel_confirmation_reference}`.toLowerCase();
    if (seen.has(duplicateKey)) {
      results.push({
        rowNumber: row.rowNumber,
        status: "failed",
        code: "duplicate_row_in_file",
        message: "Duplicate row in import file.",
        registrationId: row.registration_id || null,
      });
      failedCount += 1;
      continue;
    }
    seen.add(duplicateKey);

    if (!row.conference_id || row.conference_id !== input.conferenceId) {
      results.push({
        rowNumber: row.rowNumber,
        status: "failed",
        code: "conference_mismatch",
        message: "conference_id is missing or does not match the selected conference.",
        registrationId: row.registration_id || null,
      });
      failedCount += 1;
      continue;
    }
    if (!row.registration_id && !row.user_id) {
      results.push({
        rowNumber: row.rowNumber,
        status: "failed",
        code: "missing_required_field",
        message: "Either registration_id or user_id is required.",
        registrationId: null,
      });
      failedCount += 1;
      continue;
    }

    const normalizedTravelMode = normalizeTravelMode(row.travel_mode);
    if (row.travel_mode.trim() && !normalizedTravelMode) {
      results.push({
        rowNumber: row.rowNumber,
        status: "failed",
        code: "invalid_travel_mode",
        message: "travel_mode must be one of: flight/air/road/rail/bus/personal_vehicle/other.",
        registrationId: row.registration_id || null,
      });
      failedCount += 1;
      continue;
    }

    let registrationQuery = adminClient
      .from("conference_registrations")
      .select("id, conference_id, user_id, travel_mode, arrival_flight_details, departure_flight_details, hotel_name, hotel_confirmation_code, admin_notes, registration_custom_answers")
      .eq("conference_id", input.conferenceId);
    if (row.registration_id) {
      registrationQuery = registrationQuery.eq("id", row.registration_id);
    } else {
      registrationQuery = registrationQuery.eq("user_id", row.user_id);
    }
    const regRes = await registrationQuery.maybeSingle();
    if (regRes.error || !regRes.data) {
      results.push({
        rowNumber: row.rowNumber,
        status: "failed",
        code: "unknown_user_or_registration",
        message: "No matching registration found for row.",
        registrationId: row.registration_id || null,
      });
      failedCount += 1;
      continue;
    }
    const existing = regRes.data as unknown as { id: string; conference_id: string; user_id: string | null; travel_mode: string | null; arrival_flight_details: string | null; departure_flight_details: string | null; hotel_name: string | null; hotel_confirmation_code: string | null; admin_notes: string | null; registration_custom_answers: Record<string, unknown> | null };
    const registrationId = existing.id;

    const updatePayload: RegistrationUpdate = {
      updated_at: new Date().toISOString(),
    };
    const existingRecord = existing as unknown as Record<string, unknown>;
    const setField = <K extends keyof RegistrationUpdate>(key: K, value: RegistrationUpdate[K]) => {
      if (input.mode === "skip_if_existing" && existingRecord[key as string] != null && String(existingRecord[key as string]).trim() !== "") {
        return false;
      }
      if (input.mode === "fill_empty_only" && existingRecord[key as string] != null && String(existingRecord[key as string]).trim() !== "") {
        return false;
      }
      updatePayload[key] = value;
      return true;
    };

    const arrivalDetails = buildFlightDetails({
      flightNumber: row.arrival_flight_number,
      airport: row.arrival_airport,
      datetime: row.arrival_datetime,
    });
    const departureDetails = buildFlightDetails({
      flightNumber: row.departure_flight_number,
      airport: row.departure_airport,
      datetime: row.departure_datetime,
    });

    let changed = false;
    if (normalizedTravelMode) changed = setField("travel_mode", normalizedTravelMode) || changed;
    if (arrivalDetails) changed = setField("arrival_flight_details", arrivalDetails) || changed;
    if (departureDetails) changed = setField("departure_flight_details", departureDetails) || changed;
    if (row.lodging_property.trim()) changed = setField("hotel_name", row.lodging_property.trim()) || changed;
    if (row.hotel_confirmation_number.trim()) {
      changed =
        setField("hotel_confirmation_code", row.hotel_confirmation_number.trim()) || changed;
    }
    if (row.admin_note.trim()) changed = setField("admin_notes", row.admin_note.trim()) || changed;

    const existingAnswers =
      existing.registration_custom_answers &&
      typeof existing.registration_custom_answers === "object" &&
      !Array.isArray(existing.registration_custom_answers)
        ? (existing.registration_custom_answers as Record<string, unknown>)
        : {};
    const importedMeta = {
      room_number: row.room_number.trim() || null,
      travel_confirmation_reference: row.travel_confirmation_reference.trim() || null,
      imported_at: new Date().toISOString(),
      imported_by: auth.ctx.userId,
    };
    (updatePayload as Record<string, unknown>).registration_custom_answers = {
      ...existingAnswers,
      travel_import_meta: importedMeta,
    };
    changed = true;

    if (!changed) {
      results.push({
        rowNumber: row.rowNumber,
        status: "skipped",
        code: "conflict_skipped_existing",
        message: "Skipped due to conflict mode and existing values.",
        registrationId,
      });
      skippedCount += 1;
      continue;
    }

    if (!input.dryRun) {
      const updateRes = await adminClient
        .from("conference_registrations")
        .update(updatePayload)
        .eq("id", registrationId);
      if (updateRes.error) {
        results.push({
          rowNumber: row.rowNumber,
          status: "failed",
          code: "write_failed",
          message: updateRes.error.message,
          registrationId,
        });
        failedCount += 1;
        continue;
      }
    }

    results.push({
      rowNumber: row.rowNumber,
      status: "success",
      code: "ok",
      message: input.dryRun ? "Dry-run validation passed." : "Applied.",
      registrationId,
    });
    appliedCount += 1;
  }

  await logAuditEventSafe({
    action: input.dryRun ? "conference_travel_import_dry_run" : "conference_travel_import_applied",
    entityType: "conference_instance",
    entityId: input.conferenceId,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      idempotency_key: idempotencyKey,
      mode: input.mode,
      row_count: rows.length,
      applied_count: appliedCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      file_hash: fileHash,
    },
  });

  return {
    success: true,
    data: {
      dryRun: Boolean(input.dryRun),
      idempotencyKey,
      appliedCount,
      skippedCount,
      failedCount,
      rows: results,
    },
  };
}
