"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ConferencePerson = {
  id: string;
  person_kind: string;
  display_name: string | null;
  contact_email: string | null;
  checked_in_at: string | null;
  badge_print_status: string | null;
  hotel_name: string | null;
  hotel_confirmation_code: string | null;
  travel_mode: string | null;
};

type PendingScan = {
  qr_token: string;
  scan_timestamp: string;
  device_id?: string;
};

type CameraState = "idle" | "requesting" | "active" | "denied" | "unsupported" | "error";

type ScanPulseCard = {
  id: string;
  state: string;
  personId: string | null;
  expiresAt: number;
  displayName: string | null;
  personKind: string | null;
  checkedInAt: string | null;
  badgePrintStatus: string | null;
  hotelName: string | null;
  hotelConfirmationCode: string | null;
  travelMode: string | null;
};

const POLL_MS = 30_000;
const SCAN_PULSE_TTL_MS = 30_000;
const SCAN_PULSE_LIMIT = 3;
const PENDING_SCAN_STORAGE_PREFIX = "check-in-desk-pending-scans";

const SCAN_STATUS_COPY: Record<
  string,
  { title: string; description: string; className: string }
> = {
  valid: {
    title: "Checked In",
    description: "Badge token resolved and check-in applied.",
    className: "text-emerald-700",
  },
  already_checked_in: {
    title: "Already Checked In",
    description: "No action needed; this attendee was already checked in.",
    className: "text-[#D92327]",
  },
  invalid_token: {
    title: "Invalid Token",
    description: "Badge token was not recognized.",
    className: "text-amber-700",
  },
  revoked_token: {
    title: "Revoked Token",
    description: "Badge token has been revoked or rotated.",
    className: "text-amber-700",
  },
  not_found: {
    title: "Not Found",
    description: "No active conference person found for this token.",
    className: "text-amber-700",
  },
  queued_offline: {
    title: "Queued Offline",
    description: "Scan queued locally and will retry when network returns.",
    className: "text-purple-700",
  },
  scan_failed: {
    title: "Scan Failed",
    description: "Could not process scan. Try again.",
    className: "text-red-700",
  },
  badge_reprinted: {
    title: "Badge Reprinted",
    description: "Badge reprint was queued successfully.",
    className: "text-cyan-700",
  },
};

function looksMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

interface CheckInDeskClientProps {
  conferenceId: string;
  initialRows: ConferencePerson[];
}

export default function CheckInDeskClient({
  conferenceId,
  initialRows,
}: CheckInDeskClientProps) {
  const [rows, setRows] = useState<ConferencePerson[]>(initialRows);
  const [scanToken, setScanToken] = useState("");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanCards, setScanCards] = useState<ScanPulseCard[]>([]);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [pendingScans, setPendingScans] = useState<PendingScan[]>([]);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerReaderRef = useRef<{ reset?: () => void } | null>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const lastDecodedRef = useRef<{ value: string; at: number } | null>(null);
  const pendingScanStorageKey = `${PENDING_SCAN_STORAGE_PREFIX}:${conferenceId}`;

  const pushScanCard = useCallback(
    (state: string, personId: string | null) => {
      const person = personId ? rows.find((row) => row.id === personId) ?? null : null;
      const createdAt = Date.now();
      const card: ScanPulseCard = {
        id: `${createdAt}:${personId ?? "none"}:${Math.random().toString(36).slice(2, 8)}`,
        state,
        personId,
        expiresAt: createdAt + SCAN_PULSE_TTL_MS,
        displayName: person?.display_name ?? person?.contact_email ?? null,
        personKind: person?.person_kind ?? null,
        checkedInAt: person?.checked_in_at ?? null,
        badgePrintStatus: person?.badge_print_status ?? null,
        hotelName: person?.hotel_name ?? null,
        hotelConfirmationCode: person?.hotel_confirmation_code ?? null,
        travelMode: person?.travel_mode ?? null,
      };
      setScanCards((prev) => [card, ...prev].slice(0, SCAN_PULSE_LIMIT));
    },
    [rows]
  );

  const loadRows = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/conference/${conferenceId}/war-room`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        rows?: ConferencePerson[];
      };
      if (!response.ok) return;
      setRows(payload.rows ?? []);
    } catch {
      // keep existing rows on transient failures
    }
  }, [conferenceId]);

  const submitScan = useCallback(
    async (
      scan: PendingScan,
      allowQueue: boolean
    ): Promise<{ state: string; personId: string | null }> => {
      try {
        const response = await fetch(`/api/admin/conference/${conferenceId}/check-in/scan`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(scan),
        });
        const payload = (await response.json()) as {
          state?: string;
          error?: string;
          person_id?: string | null;
        };
        if (!response.ok) {
          return { state: payload.error ?? "scan_failed", personId: null };
        }
        return {
          state: payload.state ?? "invalid_token",
          personId: payload.person_id ?? null,
        };
      } catch {
        if (allowQueue) {
          setPendingScans((prev) => [...prev, scan]);
          return { state: "queued_offline", personId: null };
        }
        return { state: "scan_failed", personId: null };
      }
    },
    [conferenceId]
  );

  const submitToken = useCallback(
    async (token: string) => {
      const result = await submitScan(
        {
          qr_token: token,
          scan_timestamp: new Date().toISOString(),
          device_id: selectedCameraId || undefined,
        },
        true
      );
      setScanResult(result.state);
      pushScanCard(result.state, result.personId);
      await loadRows();
    },
    [loadRows, pushScanCard, selectedCameraId, submitScan]
  );

  const stopCameraScanner = useCallback(() => {
    try {
      scannerControlsRef.current?.stop();
      scannerReaderRef.current?.reset?.();
    } catch {
      // best effort
    }
    scannerControlsRef.current = null;
    scannerReaderRef.current = null;
    setCameraState((prev) => (prev === "active" || prev === "requesting" ? "idle" : prev));
  }, []);

  const refreshCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter((d) => d.kind === "videoinput");
    setCameraDevices(videoInputs);
    if (!selectedCameraId && videoInputs.length > 0) {
      setSelectedCameraId(videoInputs[0].deviceId);
    }
  }, [selectedCameraId]);

  const startCameraScanner = useCallback(async () => {
    if (typeof window === "undefined") return;
    const video = videoRef.current;
    if (!video) {
      setCameraState("error");
      setCameraError("Camera preview unavailable.");
      return;
    }

    setCameraError(null);
    setCameraState("requesting");
    stopCameraScanner();

    try {
      const zxing = await import("@zxing/browser");
      const reader = new zxing.BrowserMultiFormatReader();
      scannerReaderRef.current = reader as unknown as { reset?: () => void };

      const controls = await reader.decodeFromVideoDevice(
        selectedCameraId || undefined,
        video,
        async (result, err) => {
          if (err || !result) return;
          const raw = result.getText?.().trim();
          if (!raw) return;
          const now = Date.now();
          const last = lastDecodedRef.current;
          if (last && last.value === raw && now - last.at < 3000) return;
          lastDecodedRef.current = { value: raw, at: now };
          setScanToken(raw);
          await submitToken(raw);
        }
      );
      scannerControlsRef.current = controls as unknown as { stop: () => void };
      setCameraState("active");
      await refreshCameraDevices();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lower = message.toLowerCase();
      if (lower.includes("permission") || lower.includes("denied")) {
        setCameraState("denied");
        setCameraError("Camera permission denied.");
      } else if (lower.includes("not supported") || lower.includes("secure context")) {
        setCameraState("unsupported");
        setCameraError("Camera scanning not supported in this browser/context.");
      } else {
        setCameraState("error");
        setCameraError(message || "Unable to start camera scanner.");
      }
    }
  }, [refreshCameraDevices, selectedCameraId, stopCameraScanner, submitToken]);

  const cycleCamera = useCallback(() => {
    if (cameraDevices.length < 2) return;
    const index = cameraDevices.findIndex((d) => d.deviceId === selectedCameraId);
    const next = cameraDevices[(index + 1 + cameraDevices.length) % cameraDevices.length];
    setSelectedCameraId(next.deviceId);
  }, [cameraDevices, selectedCameraId]);

  const runManualScan = async () => {
    if (!scanToken.trim()) {
      setScanResult("invalid_token");
      return;
    }
    await submitToken(scanToken.trim());
  };

  const reprintBadge = useCallback(
    async (personId: string) => {
      const reprintReasonRaw = window.prompt(
        "Reprint reason (damaged, lost, name_change, ops_override):",
        "damaged"
      );
      if (!reprintReasonRaw) return;
      const reprintReason = reprintReasonRaw.trim().toLowerCase();
      if (!["damaged", "lost", "name_change", "ops_override"].includes(reprintReason)) {
        setScanResult("scan_failed");
        return;
      }
      const reprintNote = window.prompt("Optional reprint note:", "") ?? "";
      try {
        const response = await fetch(`/api/admin/conference/${conferenceId}/people/${personId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            op: "reprint_badge",
            reprintReason: reprintReason,
            reprintNote: reprintNote.trim().length > 0 ? reprintNote.trim() : null,
          }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          setScanResult(payload.error ?? "scan_failed");
          return;
        }
        setScanResult("badge_reprinted");
        await loadRows();
      } catch {
        setScanResult("scan_failed");
      }
    },
    [conferenceId, loadRows]
  );

  const activeCards = useMemo(
    () => scanCards.filter((card) => card.expiresAt > nowMs),
    [nowMs, scanCards]
  );

  useEffect(() => {
    setIsMobile(looksMobile());
    void refreshCameraDevices();
    void loadRows();
    const pollId = window.setInterval(() => void loadRows(), POLL_MS);
    const clockId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.clearInterval(pollId);
      window.clearInterval(clockId);
      stopCameraScanner();
    };
  }, [loadRows, refreshCameraDevices, stopCameraScanner]);

  useEffect(() => {
    const raw = window.localStorage.getItem(pendingScanStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PendingScan[];
      if (Array.isArray(parsed)) setPendingScans(parsed);
    } catch {
      setPendingScans([]);
    }
  }, [pendingScanStorageKey]);

  useEffect(() => {
    window.localStorage.setItem(pendingScanStorageKey, JSON.stringify(pendingScans));
  }, [pendingScans, pendingScanStorageKey]);

  useEffect(() => {
    if (!navigator.onLine || pendingScans.length === 0) return;
    const flush = async () => {
      const remaining: PendingScan[] = [];
      for (const scan of pendingScans) {
        const result = await submitScan(scan, false);
        if (result.state === "scan_failed") {
          remaining.push(scan);
        } else {
          setScanResult(result.state);
          pushScanCard(result.state, result.personId);
        }
      }
      setPendingScans(remaining);
      await loadRows();
    };
    void flush();
  }, [loadRows, pendingScans, pushScanCard, submitScan]);

  useEffect(() => {
    void startCameraScanner();
  }, [startCameraScanner]);

  useEffect(() => {
    document.body.classList.add("check-in-kiosk");
    return () => {
      document.body.classList.remove("check-in-kiosk");
    };
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <video ref={videoRef} className="h-full w-full object-cover" muted autoPlay playsInline />
      {cameraError ? (
        <div className="absolute left-3 right-3 top-3 rounded-md bg-black/75 px-3 py-2 text-xs text-amber-300">
          {cameraError}
        </div>
      ) : null}

      {activeCards.length > 0 ? (
        <div className="absolute right-4 top-4 w-[min(420px,92vw)] space-y-2">
          {activeCards.map((card) => (
            <div key={card.id} className="rounded-md bg-black/75 p-3 text-sm">
              <p className={SCAN_STATUS_COPY[card.state]?.className ?? "text-gray-200"}>
                <span className="font-semibold">
                  {SCAN_STATUS_COPY[card.state]?.title ?? "Scan Result"}
                </span>
                {" - "}
                {SCAN_STATUS_COPY[card.state]?.description ?? card.state}
              </p>
              {card.displayName ? (
                <p className="mt-1 text-white">
                  {card.displayName}
                  {card.personKind ? ` (${card.personKind})` : ""}
                </p>
              ) : null}
              {card.hotelName ? <p className="text-xs text-gray-200">Room: {card.hotelName}</p> : null}
              {card.travelMode ? <p className="text-xs text-gray-300">Travel: {card.travelMode}</p> : null}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedCardId((prev) => (prev === card.id ? null : card.id))
                  }
                  className="rounded border border-white/40 px-2 py-0.5 text-[11px] font-medium text-white"
                >
                  Details
                </button>
                {card.personId ? (
                  <button
                    type="button"
                    onClick={() => void reprintBadge(card.personId as string)}
                    className="rounded border border-white/40 px-2 py-0.5 text-[11px] font-medium text-white"
                  >
                    Reprint Badge
                  </button>
                ) : null}
              </div>
              {expandedCardId === card.id ? (
                <div className="mt-2 rounded border border-white/20 bg-black/50 p-2 text-[11px] text-gray-200">
                  <p>Email: {rows.find((r) => r.id === card.personId)?.contact_email ?? "n/a"}</p>
                  <p>Checked in: {card.checkedInAt ? "yes" : "no"}</p>
                  <p>Badge: {card.badgePrintStatus ?? "unknown"}</p>
                  <p>Hotel confirm: {card.hotelConfirmationCode ?? "n/a"}</p>
                </div>
              ) : null}
              <p className="mt-1 text-[11px] text-gray-300">
                {Math.max(0, Math.ceil((card.expiresAt - nowMs) / 1000))}s
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-2">
        <div className="flex flex-wrap items-center gap-2">
          {isMobile ? (
            <button
              type="button"
              onClick={cycleCamera}
              disabled={cameraDevices.length < 2}
              className="rounded border border-white/50 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
            >
              Switch Camera
            </button>
          ) : cameraDevices.length > 1 ? (
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="rounded border border-white/50 bg-black px-2 py-1 text-xs text-white"
            >
              {cameraDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          ) : null}
          {cameraState !== "active" ? (
            <button
              type="button"
              onClick={() => void startCameraScanner()}
              className="rounded border border-white/50 px-2 py-1 text-xs font-medium text-white"
            >
              Retry
            </button>
          ) : null}
          <input
            value={scanToken}
            onChange={(e) => setScanToken(e.target.value)}
            placeholder="Paste QR token"
            className="min-w-[220px] flex-1 rounded border border-white/40 bg-black px-2 py-1 text-xs text-white placeholder:text-gray-400"
          />
          <button
            type="button"
            onClick={() => void runManualScan()}
            className="rounded border border-white/50 px-3 py-1 text-xs font-medium text-white"
          >
            Scan
          </button>
          {scanResult ? (
            <p className={`text-xs ${SCAN_STATUS_COPY[scanResult]?.className ?? "text-gray-200"}`}>
              {SCAN_STATUS_COPY[scanResult]?.title ?? "Scan"}
            </p>
          ) : null}
          {pendingScans.length > 0 ? (
            <p className="text-xs text-purple-300">{pendingScans.length} queued</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
