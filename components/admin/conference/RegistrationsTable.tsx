"use client";

import { useState, useEffect } from "react";
import { parseUTC } from "@/lib/utils";
import {
  getAllRegistrations,
  recordRegistrationExportEvent,
  reviewTravelWindowException,
  type AdminRegistrationRow,
  type RegistrationExportPreset,
} from "@/lib/actions/conference-registration";
import {
  getTravelImportTemplateCsv,
  importConferenceTravelCsv,
  type TravelImportConflictMode,
} from "@/lib/actions/conference-travel-import";
import {
  REGISTRATION_STATUSES,
  REGISTRATION_TYPES,
  REGISTRATION_STATUS_LABELS,
  type RegistrationStatus,
} from "@/lib/constants/conference";

interface RegistrationsTableProps {
  conferenceId: string;
}

export default function RegistrationsTable({ conferenceId }: RegistrationsTableProps) {
  const [registrations, setRegistrations] = useState<AdminRegistrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCreatedFrom, setFilterCreatedFrom] = useState("");
  const [filterCreatedTo, setFilterCreatedTo] = useState("");
  const [sharedWith, setSharedWith] = useState("");
  const [importMode, setImportMode] = useState<TravelImportConflictMode>("fill_empty_only");
  const [importCsvText, setImportCsvText] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  useEffect(() => {
    loadRegistrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterType, filterCreatedFrom, filterCreatedTo]);

  const loadRegistrations = async () => {
    setLoading(true);
    const result = await getAllRegistrations(conferenceId, {
      status: filterStatus || undefined,
      registration_type: filterType || undefined,
      created_at_from: filterCreatedFrom || undefined,
      created_at_to: filterCreatedTo || undefined,
    });
    setLoading(false);
    if (result.success) {
      setRegistrations(result.data ?? []);
      setError(null);
    } else {
      setError(result.error ?? "Failed to load");
    }
  };

  const toCsvCell = (value: unknown): string =>
    `"${String(
      value == null ? "" : typeof value === "object" ? JSON.stringify(value) : value
    ).replaceAll("\"", "\"\"")}"`;

  const downloadCsv = (filename: string, header: string[], lines: string[]) => {
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    if (registrations.length === 0) return;
    const header = [
      "id",
      "conference_id",
      "organization_id",
      "user_id",
      "registration_type",
      "status",
      "created_at",
      "updated_at",
    ];
    const lines = registrations.map((reg) =>
      [
        reg.id,
        reg.conference_id,
        reg.organization_id,
        reg.user_id,
        reg.registration_type,
        reg.status,
        reg.created_at,
        reg.updated_at,
      ]
        .map((value) => toCsvCell(value))
        .join(",")
    );
    downloadCsv(`conference-registrations-${conferenceId}.csv`, header, lines);
  };

  const getValueByKey = (reg: AdminRegistrationRow, key: string): unknown =>
    (reg as unknown as Record<string, unknown>)[key];

  const getDisplayName = (reg: AdminRegistrationRow): string => getUserLabel(reg);
  const getContactEmail = (reg: AdminRegistrationRow): string => {
    const raw = reg as unknown as Record<string, unknown>;
    if (typeof raw.contact_email === "string" && raw.contact_email.trim()) return raw.contact_email.trim();
    if (typeof raw.assigned_email_snapshot === "string" && raw.assigned_email_snapshot.trim()) {
      return raw.assigned_email_snapshot.trim();
    }
    return "";
  };

  const exportPresetCsv = async (preset: RegistrationExportPreset) => {
    if (registrations.length === 0) return;

    if (preset === "emergency_contacts") {
      const proceed = window.confirm(
        "Emergency contact export contains sensitive personal data. Continue?"
      );
      if (!proceed) return;
    }

    let header: string[] = [];
    let lines: string[] = [];
    const filename = `conference-registrations-${conferenceId}-${preset}.csv`;

    if (preset === "summary") {
      exportCsv();
      await recordRegistrationExportEvent({
        conferenceId,
        preset,
        rowCount: registrations.length,
        sharedWith: sharedWith.trim() || null,
        filters: {
          status: filterStatus || null,
          registration_type: filterType || null,
          created_at_from: filterCreatedFrom || null,
          created_at_to: filterCreatedTo || null,
        },
      });
      return;
    }

    if (preset === "all") {
      exportAllCsv();
      await recordRegistrationExportEvent({
        conferenceId,
        preset,
        rowCount: registrations.length,
        sharedWith: sharedWith.trim() || null,
        filters: {
          status: filterStatus || null,
          registration_type: filterType || null,
          created_at_from: filterCreatedFrom || null,
          created_at_to: filterCreatedTo || null,
        },
      });
      return;
    }

    if (preset === "hotel_rooming") {
      header = [
        "display_name",
        "contact_email",
        "organization_name",
        "registration_type",
        "hotel_name",
        "hotel_confirmation_code",
        "arrival_date",
        "departure_date",
        "travel_mode",
      ];
      lines = registrations.map((reg) =>
        [
          getDisplayName(reg),
          getContactEmail(reg),
          reg.organization_name,
          reg.registration_type,
          getValueByKey(reg, "hotel_name"),
          getValueByKey(reg, "hotel_confirmation_code"),
          getValueByKey(reg, "arrival_date"),
          getValueByKey(reg, "departure_date"),
          getValueByKey(reg, "travel_mode"),
        ]
          .map((value) => toCsvCell(value))
          .join(",")
      );
    }

    if (preset === "airline_booking") {
      const airlineRows = registrations.filter((reg) => {
        const travelMode = String(getValueByKey(reg, "travel_mode") ?? "").trim().toLowerCase();
        return travelMode === "flight";
      });
      if (airlineRows.length === 0) {
        setError("No flight travelers found for the current filters.");
        return;
      }
      header = [
        "legal_name",
        "display_name",
        "date_of_birth",
        "gender",
        "contact_email",
        "mobile_phone",
        "organization_name",
        "registration_type",
        "preferred_departure_airport",
        "nexus_trusted_traveler",
        "travel_mode",
        "arrival_flight_details",
        "departure_flight_details",
        "seat_preference",
      ];
      lines = airlineRows.map((reg) =>
        [
          getValueByKey(reg, "legal_name"),
          getDisplayName(reg),
          getValueByKey(reg, "date_of_birth"),
          getValueByKey(reg, "gender"),
          getContactEmail(reg),
          getValueByKey(reg, "mobile_phone"),
          reg.organization_name,
          reg.registration_type,
          getValueByKey(reg, "preferred_departure_airport"),
          getValueByKey(reg, "nexus_trusted_traveler"),
          getValueByKey(reg, "travel_mode"),
          getValueByKey(reg, "arrival_flight_details"),
          getValueByKey(reg, "departure_flight_details"),
          getValueByKey(reg, "seat_preference"),
        ]
          .map((value) => toCsvCell(value))
          .join(",")
      );
    }

    if (preset === "catering_dietary") {
      header = [
        "display_name",
        "contact_email",
        "organization_name",
        "registration_type",
        "dietary_restrictions",
        "accessibility_needs",
      ];
      lines = registrations.map((reg) =>
        [
          getDisplayName(reg),
          getContactEmail(reg),
          reg.organization_name,
          reg.registration_type,
          getValueByKey(reg, "dietary_restrictions"),
          getValueByKey(reg, "accessibility_needs"),
        ]
          .map((value) => toCsvCell(value))
          .join(",")
      );
    }

    if (preset === "emergency_contacts") {
      header = [
        "display_name",
        "contact_email",
        "organization_name",
        "mobile_phone",
        "emergency_contact_name",
        "emergency_contact_phone",
      ];
      lines = registrations.map((reg) =>
        [
          getDisplayName(reg),
          getContactEmail(reg),
          reg.organization_name,
          getValueByKey(reg, "mobile_phone"),
          getValueByKey(reg, "emergency_contact_name"),
          getValueByKey(reg, "emergency_contact_phone"),
        ]
          .map((value) => toCsvCell(value))
          .join(",")
      );
    }

    if (header.length === 0) return;
    downloadCsv(filename, header, lines);
    await recordRegistrationExportEvent({
      conferenceId,
      preset,
      rowCount: lines.length,
      sharedWith: sharedWith.trim() || null,
      filters: {
        status: filterStatus || null,
        registration_type: filterType || null,
        created_at_from: filterCreatedFrom || null,
        created_at_to: filterCreatedTo || null,
      },
    });
  };

  const exportAllCsv = () => {
    if (registrations.length === 0) return;

    const preferredColumns = [
      "id",
      "conference_id",
      "organization_id",
      "organization_name",
      "user_id",
      "user_display_name",
      "registration_type",
      "status",
      "created_at",
      "updated_at",
    ];

    const keySet = new Set<string>();
    registrations.forEach((reg) => {
      Object.keys(reg).forEach((key) => keySet.add(key));
    });

    const dynamicColumns = Array.from(keySet).sort((a, b) => a.localeCompare(b));
    const preferred = preferredColumns.filter((key) => keySet.has(key));
    const remaining = dynamicColumns.filter((key) => !preferred.includes(key));
    const header = [...preferred, ...remaining];

    const lines = registrations.map((reg) => header.map((key) => toCsvCell(getValueByKey(reg, key))).join(","));

    downloadCsv(`conference-registrations-all-${conferenceId}.csv`, header, lines);
  };

  const getTravelExceptionStatus = (
    reg: AdminRegistrationRow
  ): "none" | "pending" | "approved" | "rejected" => {
    const customAnswers = (reg as unknown as { registration_custom_answers?: Record<string, unknown> | null })
      .registration_custom_answers;
    if (!customAnswers || typeof customAnswers !== "object" || Array.isArray(customAnswers)) {
      return "none";
    }
    const raw = (customAnswers as Record<string, unknown>).travel_window_exception;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "none";
    const status = (raw as Record<string, unknown>).status;
    if (status === "pending" || status === "approved" || status === "rejected") {
      return status;
    }
    return "none";
  };

  const getUserLabel = (reg: AdminRegistrationRow): string => {
    const profileName = reg.user_display_name?.trim();
    if (profileName) return profileName;
    const raw = reg as unknown as Record<string, unknown>;
    const displayName = typeof raw.display_name === "string" ? raw.display_name.trim() : "";
    if (displayName) return displayName;
    const contactEmail = typeof raw.contact_email === "string" ? raw.contact_email.trim() : "";
    if (contactEmail) return contactEmail;
    return reg.user_id ? `${reg.user_id.slice(0, 8)}...` : "Unknown user";
  };

  const getTravelOpsSummary = (reg: AdminRegistrationRow): string | null => {
    const raw = reg as unknown as Record<string, unknown>;
    const customAnswers =
      raw.registration_custom_answers &&
      typeof raw.registration_custom_answers === "object" &&
      !Array.isArray(raw.registration_custom_answers)
        ? (raw.registration_custom_answers as Record<string, unknown>)
        : null;
    const classification =
      customAnswers?.travel_ops_classification &&
      typeof customAnswers.travel_ops_classification === "object" &&
      !Array.isArray(customAnswers.travel_ops_classification)
        ? (customAnswers.travel_ops_classification as Record<string, unknown>)
        : null;
    if (!classification) return null;

    const support = typeof classification.effective_travel_support_mode === "string"
      ? classification.effective_travel_support_mode
      : "unknown";
    const travelBookingOwner = typeof classification.travel_booking_owner === "string"
      ? classification.travel_booking_owner
      : "unknown";
    const accommodationBookingOwner = typeof classification.accommodation_booking_owner === "string"
      ? classification.accommodation_booking_owner
      : "unknown";
    const airAllowed =
      typeof classification.air_travel_allowed === "boolean"
        ? classification.air_travel_allowed
          ? "air allowed"
          : "air blocked"
        : "air unknown";

    return `Travel: ${support} (${travelBookingOwner}), Accom: ${accommodationBookingOwner}, ${airAllowed}`;
  };

  const handleReviewException = async (
    registrationId: string,
    decision: "approved" | "rejected"
  ) => {
    const note = window.prompt(
      decision === "approved"
        ? "Optional approval note:"
        : "Optional rejection note:"
    ) ?? "";
    setActioningId(registrationId);
    const result = await reviewTravelWindowException(registrationId, decision, note);
    setActioningId(null);
    if (!result.success) {
      setError(result.error ?? "Failed to review travel-window exception.");
      return;
    }
    await loadRegistrations();
  };

  const handleDownloadTravelTemplate = async () => {
    const csv = getTravelImportTemplateCsv();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `conference-travel-import-template-${conferenceId}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const runTravelImport = async (dryRun: boolean) => {
    if (!importCsvText.trim()) {
      setError("Paste CSV or upload a CSV file before running travel import.");
      return;
    }
    setImportLoading(true);
    setImportSummary(null);
    const result = await importConferenceTravelCsv({
      conferenceId,
      csvText: importCsvText,
      mode: importMode,
      dryRun,
    });
    setImportLoading(false);
    if (!result.success || !result.data) {
      setError(result.error ?? "Travel import failed.");
      return;
    }
    const summary = `${dryRun ? "Dry-run" : "Apply"} complete: ${result.data.appliedCount} success, ${result.data.skippedCount} skipped, ${result.data.failedCount} failed.`;
    setImportSummary(summary);
    setError(null);
    if (!dryRun) {
      await loadRegistrations();
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All statuses</option>
          {REGISTRATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REGISTRATION_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
        >
          <option value="">All types</option>
          {REGISTRATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={filterCreatedFrom}
          onChange={(e) => setFilterCreatedFrom(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
          aria-label="Created from date"
          title="Created from"
        />
        <input
          type="date"
          value={filterCreatedTo}
          onChange={(e) => setFilterCreatedTo(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
          aria-label="Created to date"
          title="Created to"
        />
        <input
          type="text"
          value={sharedWith}
          onChange={(e) => setSharedWith(e.target.value)}
          placeholder="Shared with (optional)"
          className="min-w-56 px-3 py-1.5 border border-gray-300 rounded-md text-sm"
        />
        <button
          type="button"
          onClick={() => void exportPresetCsv("summary")}
          disabled={registrations.length === 0}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Export Summary
        </button>
        <button
          type="button"
          onClick={() => void exportPresetCsv("hotel_rooming")}
          disabled={registrations.length === 0}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Hotel Rooming
        </button>
        <button
          type="button"
          onClick={() => void exportPresetCsv("airline_booking")}
          disabled={registrations.length === 0}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Airline Booking
        </button>
        <button
          type="button"
          onClick={() => void exportPresetCsv("catering_dietary")}
          disabled={registrations.length === 0}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Catering Dietary
        </button>
        <button
          type="button"
          onClick={() => void exportPresetCsv("emergency_contacts")}
          disabled={registrations.length === 0}
          className="px-3 py-1.5 border border-amber-400 rounded-md text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-50"
        >
          Emergency Contacts
        </button>
        <button
          type="button"
          onClick={() => void exportPresetCsv("all")}
          disabled={registrations.length === 0}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Export All
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
        <p className="text-sm font-medium text-gray-900">Travel/Lodging Import</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleDownloadTravelTemplate()}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-100"
          >
            Download CSV Template
          </button>
          <select
            value={importMode}
            onChange={(e) => setImportMode(e.target.value as TravelImportConflictMode)}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
          >
            <option value="fill_empty_only">fill_empty_only</option>
            <option value="overwrite">overwrite</option>
            <option value="skip_if_existing">skip_if_existing</option>
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <span>Upload CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void file.text().then((text) => setImportCsvText(text));
              }}
              className="text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void runTravelImport(true)}
            disabled={importLoading}
            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            {importLoading ? "Running..." : "Dry Run"}
          </button>
          <button
            type="button"
            onClick={() => void runTravelImport(false)}
            disabled={importLoading}
            className="px-3 py-1.5 border border-blue-300 rounded-md text-sm text-blue-800 hover:bg-blue-50 disabled:opacity-50"
          >
            {importLoading ? "Running..." : "Apply Import"}
          </button>
        </div>
        <textarea
          value={importCsvText}
          onChange={(e) => setImportCsvText(e.target.value)}
          placeholder="Paste travel import CSV here (optional if uploading file)."
          className="w-full min-h-24 px-3 py-2 border border-gray-300 rounded-md text-xs font-mono"
        />
        {importSummary ? <p className="text-xs text-gray-600">{importSummary}</p> : null}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Loading registrations...</div>
      ) : registrations.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No registrations found.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Travel Exception</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {registrations.map((reg) => (
                <tr key={reg.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">
                    <div>{getUserLabel(reg)}</div>
                    {getTravelOpsSummary(reg) ? (
                      <div className="mt-1 text-xs text-gray-500">{getTravelOpsSummary(reg)}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 capitalize">{reg.registration_type}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                      reg.status === "confirmed" ? "bg-green-100 text-green-700" :
                      reg.status === "submitted" ? "bg-blue-100 text-[#D92327]" :
                      reg.status === "canceled" ? "bg-red-100 text-red-700" :
                      "bg-gray-100 text-gray-700"
                    }`}>
                      {REGISTRATION_STATUS_LABELS[reg.status as RegistrationStatus] ?? reg.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {(() => {
                      const exceptionStatus = getTravelExceptionStatus(reg);
                      if (exceptionStatus === "none") {
                        return <span className="text-gray-400">None</span>;
                      }
                      if (exceptionStatus === "pending") {
                        return (
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                              Pending
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleReviewException(reg.id, "approved")}
                              disabled={actioningId === reg.id}
                              className="rounded border border-emerald-300 px-2 py-0.5 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleReviewException(reg.id, "rejected")}
                              disabled={actioningId === reg.id}
                              className="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        );
                      }
                      if (exceptionStatus === "approved") {
                        return (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                            Approved
                          </span>
                        );
                      }
                      return (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
                          Rejected
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {parseUTC(reg.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
