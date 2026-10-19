"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { todayVerdict, type OpenSeat } from "@/lib/conference/badges/checkin";
import { addConferenceAttendee, allocateSeat } from "@/lib/actions/conference-entity-commerce";
import { ToolButton, ToolkitFabButton } from "@/components/ui/ToolkitFab";

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

/**
 * What this person holds, from the badge run — see lib/conference/badges/checkin.
 * ⛔ NOT `person_kind`. That column has three values for a conference that sells
 * ten registration types, so it called every board member a "delegate" and would
 * have called a one-day pass holder one too.
 */
type CheckInFacts = {
  organizationName: string | null;
  registrationType: string | null;
  days: string[];
  dayDates: string[];
  admittedTo: string[];
  /** Resolved server-side — see lib/conference/badges/checkin.ts. */
  reprintStock?: "company_blank" | "spare" | "none";
  reprintReason?: string;
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
  facts: CheckInFacts | null;
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
    // ⛔ Was "No action needed". It is precisely when action IS usually needed:
    // the person is back at the desk, and the badge is the reason.
    title: "Already Checked In",
    description: "They have been through the desk already.",
    className: "text-accent",
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
  // ⛔ Nothing produces this any more — checking in is administrative and is
  // never gated on paperwork. Kept only so historical events still render with
  // words rather than a raw state string.
  legal_not_accepted: {
    title: "Documents Not Accepted",
    description: "Historical result. Check-in is no longer gated on documents.",
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
  // ⛔ Its own state, not "valid". A manual check-in reported "Badge token
  // resolved and check-in applied" — no badge was scanned and no token was
  // resolved, and the desk's own record of what happened should not say
  // otherwise.
  manual_checked_in: {
    title: "Checked In by Name",
    description: "No badge scanned — checked in manually and recorded against you.",
    className: "text-emerald-700",
  },
  badge_reprinted: {
    title: "Badge Reprinted",
    description: "Badge reprint was queued successfully.",
    className: "text-cyan-700",
  },
  // A walk-up named to a seat their company already owns. Not a check-in and
  // not a print: the operator reprints from this card onto the company blank.
  seat_named: {
    title: "Named to an Open Seat",
    description: "Named to a seat their company already holds. Print their badge from here.",
    className: "text-emerald-700",
  },
};

/**
 * The scans that leave the desk with nobody in front of it resolved.
 *
 * ⛔ Every one of these used to be a dead end: a red line of copy, a countdown,
 * and no way forward — while the person whose badge would not read is still
 * standing there. A desk needs a next action, not a diagnosis. Two, in fact:
 * try the code again, or find them by name and check them in by hand.
 *
 * `legal_not_accepted` is deliberately NOT here. That scan resolved perfectly
 * — it found the person and refused on purpose — so offering to look them up
 * and hand-check them in would be offering to walk around the gate.
 */
const FAILED_SCAN_STATES = new Set([
  "invalid_token",
  "revoked_token",
  "not_found",
  "scan_failed",
]);


/**
 * Why a badge is being reprinted, in the operator's words.
 *
 * ⛔ `ops_override` is deliberately absent from the desk's quick buttons. It is
 * the reason that means "none of the above", and offering it as a one-tap
 * option next to three real reasons makes it the one people press when they are
 * in a hurry — which turns the reprint log into noise exactly when it would be
 * most useful to know why 40 badges were reprinted.
 */
const REPRINT_REASONS = [
  ["damaged", "Damaged"],
  ["lost", "Lost"],
  ["name_change", "Name change"],
] as const;
type ReprintReason = (typeof REPRINT_REASONS)[number][0];

interface CheckInDeskClientProps {
  conferenceId: string;
  initialRows: ConferencePerson[];
  initialFacts: Record<string, CheckInFacts>;
  /** Seats companies hold with nobody named — what Find shows for a company. */
  initialOpenSeats: OpenSeat[];
  /** Every date the conference runs on — see the today verdict below. */
  conferenceDates: string[];
  /** A rehearsal. Writes are tagged and resettable — see the migration. */
  testMode: boolean;
  /** Pretend it is this date, so the today verdict is rehearsable. Test only. */
  asOf: string | null;
  /** The conference's public storefront, e.g. /conference/2027/main. */
  storefrontPath: string;
}

export default function CheckInDeskClient({
  conferenceId,
  initialRows,
  initialFacts,
  initialOpenSeats,
  conferenceDates,
  testMode,
  asOf,
  storefrontPath,
}: CheckInDeskClientProps) {
  const [rows, setRows] = useState<ConferencePerson[]>(initialRows);
  const [facts, setFacts] = useState<Record<string, CheckInFacts>>(initialFacts);
  const [openSeats, setOpenSeats] = useState<OpenSeat[]>(initialOpenSeats);
  // Recovery from a scan that did not resolve — see FAILED_SCAN_STATES.
  const [nameLookup, setNameLookup] = useState("");
  const [lookupOpen, setLookupOpen] = useState(false);
  // The + menu and the camera picker under it.
  const [deskMenuOpen, setDeskMenuOpen] = useState(false);
  const [cameraPanelOpen, setCameraPanelOpen] = useState(false);
  // A panel is over the camera: drop the guide, soften the feed, stop reading.
  const panelOpen = lookupOpen || cameraPanelOpen;
  // ⛔ Read by the scanner's callback, which is created once when the camera
  // starts and would otherwise see a stale lookupOpen forever.
  const lookupOpenRef = useRef(false);
  useEffect(() => {
    lookupOpenRef.current = lookupOpen;
  }, [lookupOpen]);
  const [lookupBusy, setLookupBusy] = useState<string | null>(null);
  // Leftover rehearsal rows. ⛔ Tracked whether or not this desk is in test
  // mode: the whole risk of a writing test mode is a rehearsal nobody reset,
  // and it is the LIVE desk that needs to be told.
  const [testCounts, setTestCounts] = useState<{ people: number; events: number } | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [reprintBusy, setReprintBusy] = useState<string | null>(null);
  const [reprintOpenId, setReprintOpenId] = useState<string | null>(null);

  // The day the verdict is measured against. Real date unless a rehearsal has
  // deliberately moved it.
  const verdictNow = useMemo(
    () => (asOf ? new Date(`${asOf}T12:00:00`) : new Date()),
    [asOf]
  );
  const [scanToken, setScanToken] = useState("");
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanCards, setScanCards] = useState<ScanPulseCard[]>([]);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [pendingScans, setPendingScans] = useState<PendingScan[]>([]);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
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
        facts: personId ? facts[personId] ?? null : null,
        checkedInAt: person?.checked_in_at ?? null,
        badgePrintStatus: person?.badge_print_status ?? null,
        hotelName: person?.hotel_name ?? null,
        hotelConfirmationCode: person?.hotel_confirmation_code ?? null,
        travelMode: person?.travel_mode ?? null,
      };
      setScanCards((prev) => [card, ...prev].slice(0, SCAN_PULSE_LIMIT));

      // ⛔ Somebody the desk has never heard of — a walk-up registered after
      // this page loaded. Both halves of the card come from snapshots taken at
      // load: the NAME from `rows`, which polls every 30s, and the entitlement
      // from `facts`, which does not poll at all. So a walk-up scanned in that
      // window resolved fine, checked in fine, and rendered a card that said
      // "Checked In" and nothing else — no name, no organisation, nothing for
      // the person handing over a badge to check against. Observed on the desk,
      // not theorised.
      //
      // Refresh both and patch the card in place. One round trip per unknown
      // person, and each brings back everyone, so the next few walk-ups are
      // already covered.
      if (personId && (!facts[personId] || !person)) {
        void (async () => {
          try {
            const [rowsResponse, factsResponse] = await Promise.all([
              fetch(`/api/admin/conference/${conferenceId}/war-room`, { cache: "no-store" }),
              fetch(`/api/admin/conference/${conferenceId}/check-in/facts`, {
                cache: "no-store",
              }),
            ]);
            const freshRows = rowsResponse.ok
              ? ((await rowsResponse.json()) as { rows?: ConferencePerson[] }).rows ?? null
              : null;
            const freshPayload = factsResponse.ok
              ? ((await factsResponse.json()) as {
                  facts?: Record<string, CheckInFacts>;
                  openSeats?: OpenSeat[];
                })
              : null;
            const freshFacts = freshPayload?.facts ?? null;
            if (freshRows) setRows(freshRows);
            if (freshFacts) setFacts(freshFacts);
            if (freshPayload?.openSeats) setOpenSeats(freshPayload.openSeats);

            const freshPerson = freshRows?.find((row) => row.id === personId) ?? null;
            const fresh = freshFacts?.[personId] ?? null;
            if (!freshPerson && !fresh) return;
            setScanCards((prev) =>
              prev.map((entry) =>
                entry.id === card.id
                  ? {
                      ...entry,
                      displayName:
                        entry.displayName ??
                        freshPerson?.display_name ??
                        freshPerson?.contact_email ??
                        null,
                      facts: entry.facts ?? fresh,
                      checkedInAt: entry.checkedInAt ?? freshPerson?.checked_in_at ?? null,
                      badgePrintStatus:
                        entry.badgePrintStatus ?? freshPerson?.badge_print_status ?? null,
                      hotelName: entry.hotelName ?? freshPerson?.hotel_name ?? null,
                      hotelConfirmationCode:
                        entry.hotelConfirmationCode ??
                        freshPerson?.hotel_confirmation_code ??
                        null,
                      travelMode: entry.travelMode ?? freshPerson?.travel_mode ?? null,
                    }
                  : entry
              )
            );
          } catch {
            // The desk still resolved the badge and applied the check-in. The
            // card's detail is the half that can fail without stopping anyone.
          }
        })();
      }
    },
    [rows, facts, conferenceId]
  );

  const loadTestCounts = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/admin/conference/${conferenceId}/check-in/test-run`,
        { cache: "no-store" }
      );
      if (!response.ok) return;
      setTestCounts((await response.json()) as { people: number; events: number });
    } catch {
      // Never let this break the desk. Worst case the warning is stale.
    }
  }, [conferenceId]);

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

  const resetTestRun = useCallback(async () => {
    if (
      !window.confirm(
        "Clear every test check-in for this conference? Real check-ins are not touched."
      )
    ) {
      return;
    }
    setResetBusy(true);
    try {
      const response = await fetch(
        `/api/admin/conference/${conferenceId}/check-in/test-run`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        setScanResult("scan_failed");
        return;
      }
      setScanCards([]);
      await Promise.all([loadTestCounts(), loadRows()]);
    } catch {
      setScanResult("scan_failed");
    } finally {
      setResetBusy(false);
    }
  }, [conferenceId, loadTestCounts, loadRows]);


  const submitScan = useCallback(
    async (
      scan: PendingScan,
      allowQueue: boolean
    ): Promise<{ state: string; personId: string | null }> => {
      try {
        const response = await fetch(`/api/admin/conference/${conferenceId}/check-in/scan`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...scan, test_mode: testMode }),
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
    // testMode is read in the body — it is a prop and constant for a given page
    // load today, but leaving it out of the deps is the kind of stale closure
    // that only bites once it stops being constant.
    [conferenceId, testMode]
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
          // ⛔ Typing a name in Find with a badge somewhere in view must not
          // check that badge in behind the operator's back.
          if (lookupOpenRef.current) return;
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

  /** A badge code put into Find: check in exactly as a camera scan would. */
  const checkInByCode = async () => {
    const code = nameLookup.trim();
    if (!code) return;
    setNameLookup("");
    setLookupOpen(false);
    setScanToken(code);
    await submitToken(code);
  };

  /**
   * Check somebody in by hand, from the desk.
   *
   * ⛔ This capability already existed — in the War Room, on another screen. So
   * an operator holding a badge that would not scan had to abandon the
   * full-screen desk, find the person in a different tool, and come back. Same
   * endpoint, same audit trail, reachable from where the problem happens.
   */
  const manualCheckIn = useCallback(
    async (personId: string) => {
      setLookupBusy(personId);
      try {
        const response = await fetch(
          `/api/admin/conference/${conferenceId}/people/${personId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ op: "manual_check_in", testMode }),
          }
        );
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          setScanResult(payload.error ?? "scan_failed");
          return;
        }
        // Announce it the same way a scan does, so the desk has one place to
        // look for "what just happened" regardless of how it happened — but
        // under its own state, because it is not what a scan did.
        pushScanCard("manual_checked_in", personId);
        setLookupOpen(false);
        setNameLookup("");
        await loadRows();
      } catch {
        setScanResult("scan_failed");
      } finally {
        setLookupBusy(null);
      }
    },
    [conferenceId, pushScanCard, loadRows]
  );

  /**
   * ⚠️ Searches the desk's roster snapshot, which polls every 30 seconds — so a
   * walk-up registered moments ago may not be here yet. The empty state says so
   * rather than letting the operator conclude the person does not exist.
   */
  const lookupMatches = useMemo(() => {
    const q = nameLookup.trim().toLowerCase();
    if (q.length < 2) return [];
    return rows
      .filter(
        (row) =>
          (row.display_name ?? "").toLowerCase().includes(q) ||
          (row.contact_email ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [nameLookup, rows]);

  /**
   * Companies matching the search, with the seats they hold that nobody is
   * named to. ⛔ Only companies WITH open seats: a company with none has
   * nothing to name a walk-up to, and that walk-up is a sale instead.
   */
  const companyMatches = useMemo(() => {
    const q = nameLookup.trim().toLowerCase();
    if (q.length < 2) return [];
    const byOrg = new Map<
      string,
      { organizationId: string; organizationName: string; types: Map<string, { name: string; seatIds: string[] }> }
    >();
    for (const seat of openSeats) {
      if (!seat.organizationName.toLowerCase().includes(q)) continue;
      const org =
        byOrg.get(seat.organizationId) ??
        { organizationId: seat.organizationId, organizationName: seat.organizationName, types: new Map() };
      const type = org.types.get(seat.registrationTypeId) ?? { name: seat.registrationTypeName, seatIds: [] };
      type.seatIds.push(seat.seatId);
      org.types.set(seat.registrationTypeId, type);
      byOrg.set(seat.organizationId, org);
    }
    return [...byOrg.values()]
      .map((org) => ({
        ...org,
        types: [...org.types.entries()].map(([typeId, t]) => ({ typeId, ...t })),
      }))
      .slice(0, 5);
  }, [nameLookup, openSeats]);

  // The "name someone" form, open on one company at a time.
  const [namingOrgId, setNamingOrgId] = useState<string | null>(null);
  const [walkUpName, setWalkUpName] = useState("");
  const [walkUpEmail, setWalkUpEmail] = useState("");
  const [walkUpTypeId, setWalkUpTypeId] = useState<string>("");
  const [namingBusy, setNamingBusy] = useState(false);
  const [namingError, setNamingError] = useState<string | null>(null);

  /**
   * Name a walk-up to one of their company's open seats.
   *
   * ⛔ The SAME two calls the company's own seat matrix makes on their org page:
   * addConferenceAttendee (reuses an existing person for that email) then
   * allocateSeat. No desk-only write. The card that follows carries the reprint
   * control, and its suggestion will be the company blank.
   */
  const nameWalkUp = useCallback(
    async (org: { organizationId: string; types: Array<{ typeId: string; seatIds: string[] }> }) => {
      const type = org.types.find((t) => t.typeId === walkUpTypeId) ?? org.types[0];
      const seatId = type?.seatIds[0];
      if (!seatId || !walkUpName.trim()) return;
      setNamingBusy(true);
      setNamingError(null);
      try {
        const added = await addConferenceAttendee(conferenceId, org.organizationId, {
          displayName: walkUpName.trim(),
          contactEmail: walkUpEmail.trim() || null,
        });
        if (!added.success) {
          setNamingError(added.error);
          return;
        }
        const seated = await allocateSeat(seatId, added.data.id);
        if (!seated.success) {
          setNamingError(seated.error);
          return;
        }
        setNamingOrgId(null);
        setWalkUpName("");
        setWalkUpEmail("");
        setNameLookup("");
        setLookupOpen(false);
        // An unknown person on a card makes the desk refetch roster, facts and
        // open seats — see pushScanCard.
        pushScanCard("seat_named", added.data.id);
      } catch {
        setNamingError("Could not name them to that seat. Try again.");
      } finally {
        setNamingBusy(false);
      }
    },
    [conferenceId, pushScanCard, walkUpEmail, walkUpName, walkUpTypeId]
  );

  /**
   * Reprint, in one tap, with the reason already chosen.
   *
   * ⛔ This used to be two `window.prompt` dialogs — the first asking the
   * operator to TYPE one of four snake_case enum values from memory, with a
   * silent failure if they typed anything else. That is a developer's debug
   * affordance standing in for a desk control, at a desk, with a queue.
   */
  const reprintBadge = useCallback(
    async (personId: string, reason: ReprintReason) => {
      setReprintBusy(personId);
      try {
        const response = await fetch(`/api/admin/conference/${conferenceId}/people/${personId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          // The card the desk suggested, so the job is planned for what is
          // actually in hand rather than always as a full badge.
          body: JSON.stringify({
            op: "reprint_badge",
            reprintReason: reason,
            stockInHand: facts[personId]?.reprintStock,
          }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          setScanResult(payload.error ?? "scan_failed");
          return;
        }
        setScanResult("badge_reprinted");
        pushScanCard("badge_reprinted", personId);
        await loadRows();
      } catch {
        setScanResult("scan_failed");
      } finally {
        setReprintBusy(null);
      }
    },
    [conferenceId, facts, loadRows, pushScanCard]
  );

  const activeCards = useMemo(
    () => scanCards.filter((card) => card.expiresAt > nowMs),
    [nowMs, scanCards]
  );

  useEffect(() => {
    void refreshCameraDevices();
    void loadRows();
    // ⛔ Polled on the LIVE desk too, not only in test mode. A rehearsal nobody
    // reset is the one failure a writing test mode can cause, and the desk that
    // needs to hear about it is the one being used for real.
    void loadTestCounts();
    const pollId = window.setInterval(() => {
      void loadRows();
      void loadTestCounts();
    }, POLL_MS);
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
    <div className="fixed inset-0 z-[70] overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        className={`h-full w-full object-cover transition-[filter] duration-200 ${
          panelOpen ? "blur-md brightness-50" : ""
        }`}
        muted
        autoPlay
        playsInline
      />
      {/* ⛔ Unmissable, and it covers the camera feed rather than sitting beside
          it. A test mode you can forget you are in is worse than no test mode:
          every check-in you take while it is on lands in the roster tagged, and
          somebody has to notice before the doors open. */}
      {testMode ? (
        <div className="absolute inset-x-0 top-0 z-20 bg-amber-500 px-3 py-2 text-center text-sm font-bold text-black">
          TEST MODE — check-ins are tagged and can be reset. Nothing here counts.
          {asOf ? <span className="ml-2 font-semibold">Pretending it is {asOf}.</span> : null}
          {testCounts && testCounts.people > 0 ? (
            <button
              type="button"
              disabled={resetBusy}
              onClick={() => void resetTestRun()}
              className="min-h-12 ml-3 rounded-lg bg-black px-4 font-bold text-amber-300 disabled:opacity-60"
            >
              {resetBusy ? "Clearing…" : `Reset ${testCounts.people} test check-in${testCounts.people === 1 ? "" : "s"}`}
            </button>
          ) : null}
          <a
            href={`/admin/conference/${conferenceId}/check-in`}
            className="ml-3 underline"
          >
            Leave test mode
          </a>
        </div>
      ) : null}

      {/* The leftovers warning, shown on the LIVE desk. This is the whole
          safety story for a test mode that writes: a rehearsal that was never
          reset announces itself here instead of quietly inflating day one. */}
      {!testMode && testCounts && testCounts.people + testCounts.events > 0 ? (
        <div className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center justify-center gap-3 bg-red-600 px-3 py-2 text-center text-sm font-bold text-white">
          <span>
            {testCounts.people === 1
              ? "1 test check-in from a rehearsal is still counted as real."
              : `${testCounts.people} test check-ins from a rehearsal are still counted as real.`}
          </span>
          <button
            type="button"
            disabled={resetBusy}
            onClick={() => void resetTestRun()}
            className="min-h-12 rounded-lg bg-white px-4 font-bold text-red-700 disabled:opacity-60"
          >
            {resetBusy ? "Clearing…" : "Clear them"}
          </button>
        </div>
      ) : null}

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
                <p className="mt-1 text-white">{card.displayName}</p>
              ) : null}
              {/* Who they are here with. The card used to show a bare name,
                  which is not much to go on with 166 of them. */}
              {card.facts?.organizationName ? (
                <p className="text-xs text-gray-200">{card.facts.organizationName}</p>
              ) : null}
              {/* What they hold, in the catalogue's own words. */}
              {card.facts?.registrationType ? (
                <p className="mt-1 text-sm font-semibold uppercase tracking-wide text-gray-300">
                  {card.facts.registrationType}
                </p>
              ) : null}
              {/* ⛔ The verdict, not just the data. Listing the days leaves the
                  operator comparing them to a calendar with somebody waiting;
                  this answers the question the door is actually asking. Only
                  rendered on a conference day — see todayVerdict. */}
              {(() => {
                const verdict = todayVerdict(card.facts, conferenceDates, verdictNow);
                if (!verdict) return null;
                return (
                  <p
                    className={`mt-2 rounded-lg px-3 py-2 text-base font-bold ${
                      verdict.admitted
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-red-500/25 text-red-300"
                    }`}
                  >
                    {verdict.admitted ? "ADMITTED TODAY" : "NOT VALID TODAY"}
                  </p>
                );
              })()}
              {card.facts?.days.length ? (
                <p className="text-xs text-emerald-300">{card.facts.days.join(" · ")}</p>
              ) : null}
              {card.facts?.admittedTo.length ? (
                <p className="text-sm text-gray-300">
                  {card.facts.admittedTo.join(" · ")}
                </p>
              ) : null}
              {card.hotelName ? <p className="mt-1 text-xs text-gray-200">Room: {card.hotelName}</p> : null}
              {card.travelMode ? <p className="text-xs text-gray-300">Travel: {card.travelMode}</p> : null}
              {/* ⛔ A failed scan needs a NEXT ACTION, not a diagnosis. The
                  person whose badge would not read is standing right there. */}
              {FAILED_SCAN_STATES.has(card.state) ? (
                <div className="mt-2 rounded border border-amber-400/50 bg-amber-500/10 p-2">
                  <p className="text-sm text-amber-100">
                    Nothing was checked in. Try the code again, or find them by name.
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setScanCards((prev) => prev.filter((entry) => entry.id !== card.id));
                        setScanToken("");
                        scanInputRef.current?.focus();
                      }}
                      className="min-h-12 rounded-lg bg-white px-4 text-sm font-semibold text-black"
                    >
                      Scan again
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLookupOpen(true);
                        setNameLookup("");
                      }}
                      className="min-h-12 rounded-lg border border-white/60 px-4 text-sm font-semibold text-white"
                    >
                      Find by name
                    </button>
                  </div>
                </div>
              ) : null}

              {/* ⛔ Already checked in? Assume a reprint.
                  Somebody who has already been through the desk is standing
                  here again for a reason, and it is almost always the badge:
                  damaged, lost, or the name is wrong. Treating that scan as a
                  neutral "no action needed" makes the operator go and find the
                  reprint control; treating it as a reprint makes the common
                  case one tap and the reason honest.
                  ⛔ Still a TAP, never automatic. A double scan — two cameras,
                  a jittery trigger, somebody re-presenting a badge — must not
                  queue a print job on its own. */}
              {card.state === "already_checked_in" && card.personId ? (
                <div className="mt-2 rounded border border-white/25 bg-white/5 p-2">
                  <p className="text-sm text-gray-200">
                    Already through the desk
                    {card.checkedInAt
                      ? ` at ${new Date(card.checkedInAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}`
                      : ""}
                    . Reprint their badge?
                  </p>
                  {/* ⛔ WHICH printer, before they pick a reason. A reprint is
                      two different jobs and the operator has to walk to a
                      different machine for one of them — saying so after the
                      job is queued is saying it too late. */}
                  {card.facts?.reprintStock ? (
                    <p
                      className={`mt-1.5 rounded px-1.5 py-1 text-sm ${
                        card.facts.reprintStock === "none"
                          ? "bg-amber-500/20 text-amber-100"
                          : "bg-emerald-500/20 text-emerald-100"
                      }`}
                    >
                      <strong>
                        {card.facts.reprintStock === "company_blank"
                          ? "Label onto a company blank"
                          : card.facts.reprintStock === "spare"
                            ? "Label onto a spare"
                            : "Full badge — colour printer"}
                      </strong>{" "}
                      {card.facts.reprintReason}
                      {card.facts.reprintStock === "none"
                        ? ""
                        : " Check the pile first; print in full if it is empty."}
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {REPRINT_REASONS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        disabled={reprintBusy === card.personId}
                        onClick={() => void reprintBadge(card.personId as string, value)}
                        className="min-h-12 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-50"
                      >
                        {reprintBusy === card.personId ? "…" : label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Nothing prints until you pick a reason.
                  </p>
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedCardId((prev) => (prev === card.id ? null : card.id))
                  }
                  className="min-h-12 rounded-lg border border-white/40 px-4 text-sm font-medium text-white"
                >
                  Details
                </button>
                {/* Reprint is on every other card too — it just is not the
                    assumption there, so it costs one more tap to open. */}
                {card.personId && card.state !== "already_checked_in" ? (
                  <button
                    type="button"
                    onClick={() =>
                      setReprintOpenId((prev) => (prev === card.id ? null : card.id))
                    }
                    className="min-h-12 rounded-lg border border-white/40 px-4 text-sm font-medium text-white"
                  >
                    Reprint Badge
                  </button>
                ) : null}
              </div>
              {reprintOpenId === card.id && card.personId ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {REPRINT_REASONS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      disabled={reprintBusy === card.personId}
                      onClick={() => void reprintBadge(card.personId as string, value)}
                      className="min-h-12 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-50"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
              {expandedCardId === card.id ? (
                <div className="mt-2 rounded border border-white/20 bg-black/50 p-2 text-sm text-gray-200">
                  <p>Email: {rows.find((r) => r.id === card.personId)?.contact_email ?? "n/a"}</p>
                  <p>Checked in: {card.checkedInAt ? "yes" : "no"}</p>
                  <p>Badge: {card.badgePrintStatus ?? "unknown"}</p>
                  <p>Hotel confirm: {card.hotelConfirmationCode ?? "n/a"}</p>
                </div>
              ) : null}
              <p className="mt-1 text-sm text-gray-300">
                {Math.max(0, Math.ceil((card.expiresAt - nowMs) / 1000))}s
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Find by name — the fallback for a badge that will not read.
          ⛔ Lives ON the desk. Manual check-in already existed in the War Room,
          which meant leaving this screen mid-queue to use it. */}
      {lookupOpen ? (
        // ⛔ Pinned to the TOP: on a phone or iPad the keyboard comes up from
        // the bottom, and a panel there is a panel under the keyboard.
        <div className="absolute inset-x-0 top-14 z-40 mx-auto flex max-h-[calc(100dvh-5rem)] w-[min(560px,94vw)] flex-col rounded-lg border border-white/20 bg-black/90 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-semibold text-white">Find</p>
            <button
              type="button"
              onClick={() => {
                setLookupOpen(false);
                setNameLookup("");
              }}
              className="min-h-12 rounded-lg border border-white/40 px-4 text-sm text-white"
            >
              Close
            </button>
          </div>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the operator
              opened this to type a name; anything else costs a tap at a queue. */}
          <input
            autoFocus
            value={nameLookup}
            onChange={(event) => setNameLookup(event.target.value)}
            onKeyDown={(event) => {
              // A badge code typed or pasted here — or "typed" by a handheld
              // scanner — is checked in on Enter, like a camera scan.
              if (event.key === "Enter" && looksLikeBadgeCode(nameLookup)) {
                event.preventDefault();
                void checkInByCode();
              }
            }}
            placeholder="Name, email, company or badge code"
            className="min-h-12 mt-2 w-full rounded-lg border border-white/40 bg-black px-4 text-sm text-white placeholder:text-gray-400"
          />
          {/* ⚠️ Say what this is. markConferencePersonCheckedInManual does not
              consult the document gate — it never has, and that is the point of
              an override — but making it reachable from here makes it far
              easier to reach, so the desk should not pretend otherwise. It is
              recorded as check_in_source "manual" with an audit event. */}
          <p className="mt-1 text-xs text-gray-400">
            Checking in here is a manual override recorded against you. It does not
            check documents.
          </p>
          <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {nameLookup.trim().length < 2 ? (
              <p className="text-sm text-gray-400">Type at least two characters.</p>
            ) : (
              <>
                {/* ⛔ No person can read a QR code, so there is no separate
                    "paste a token" box: a code put into Find is offered here. */}
                {looksLikeBadgeCode(nameLookup) ? (
                  <button
                    type="button"
                    onClick={() => void checkInByCode()}
                    className="min-h-12 w-full rounded-lg bg-white px-4 text-left text-base font-semibold text-black"
                  >
                    Check in by badge code
                  </button>
                ) : null}
                {/* ⛔ Companies first: a walk-up whose company already holds an
                    unnamed seat is NAMED to it, not sold another one. */}
                {companyMatches.map((org) => (
                  <div
                    key={org.organizationId}
                    className="min-h-12 rounded-lg border border-emerald-400/40 px-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-white">{org.organizationName}</p>
                        <p className="truncate text-sm text-emerald-200">
                          Open seats:{" "}
                          {org.types.map((t) => `${t.name} × ${t.seatIds.length}`).join(", ")}
                        </p>
                      </div>
                      {namingOrgId !== org.organizationId ? (
                        <button
                          type="button"
                          onClick={() => {
                            setNamingOrgId(org.organizationId);
                            setWalkUpTypeId(org.types[0]?.typeId ?? "");
                            setNamingError(null);
                          }}
                          className="min-h-12 shrink-0 rounded-lg bg-white px-4 text-sm font-semibold text-black"
                        >
                          Name someone
                        </button>
                      ) : null}
                    </div>
                    {namingOrgId === org.organizationId ? (
                      <div className="mt-1.5 space-y-1">
                        <input
                          value={walkUpName}
                          onChange={(event) => setWalkUpName(event.target.value)}
                          placeholder="Their name"
                          className="min-h-12 w-full rounded-lg border border-white/40 bg-black px-4 text-sm text-white placeholder:text-gray-400"
                        />
                        <input
                          value={walkUpEmail}
                          onChange={(event) => setWalkUpEmail(event.target.value)}
                          placeholder="Email (optional)"
                          className="min-h-12 w-full rounded-lg border border-white/40 bg-black px-4 text-sm text-white placeholder:text-gray-400"
                        />
                        {org.types.length > 1 ? (
                          <select
                            value={walkUpTypeId}
                            onChange={(event) => setWalkUpTypeId(event.target.value)}
                            className="min-h-12 w-full rounded-lg border border-white/40 bg-black px-4 text-sm text-white"
                          >
                            {org.types.map((t) => (
                              <option key={t.typeId} value={t.typeId}>
                                {t.name} ({t.seatIds.length} open)
                              </option>
                            ))}
                          </select>
                        ) : null}
                        {namingError ? (
                          <p className="text-sm text-red-300">{namingError}</p>
                        ) : null}
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={namingBusy || !walkUpName.trim()}
                            onClick={() => void nameWalkUp(org)}
                            className="min-h-12 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-50"
                          >
                            {namingBusy ? "…" : "Name to seat"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setNamingOrgId(null)}
                            className="min-h-12 rounded-lg border border-white/40 px-4 text-sm text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
                {lookupMatches.length === 0 ? (
              <div className="space-y-1">
                <p className="text-sm text-amber-200">
                  Nobody on the roster matches. ⚠️ Somebody registered in the last minute
                  may not be here yet — the desk refreshes every 30 seconds.
                  {companyMatches.length > 0
                    ? " If they are with a company above, name them to its open seat."
                    : ""}
                </p>
                {/* ⛔ A walk-up is a sale, then a seat, then a badge. The desk
                    sells through the SAME offers page and cart as everybody
                    else: pick their company, add the registration, name them in
                    the cart, then card or invoice. No desk checkout. */}
                <a
                  href={`${storefrontPath}/offers`}
                  target="_blank"
                  rel="noreferrer"
                  className="min-h-12 inline-block rounded-lg border border-white/40 px-4 text-sm text-white hover:border-white"
                >
                  Not registered? Sell them a registration →
                </a>
              </div>
            ) : (
              lookupMatches.map((row) => {
                const rowFacts = facts[row.id] ?? null;
                const verdict = todayVerdict(rowFacts, conferenceDates, verdictNow);
                return (
                  <div
                    key={row.id}
                    className="min-h-12 flex items-center justify-between gap-2 rounded-lg border border-white/15 px-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">
                        {row.display_name ?? row.contact_email ?? "Unnamed"}
                      </p>
                      <p className="truncate text-sm text-gray-300">
                        {[rowFacts?.organizationName, rowFacts?.registrationType]
                          .filter(Boolean)
                          .join(" · ") || "No registration found"}
                      </p>
                      {/* Same verdict as a scan card: hand-checking somebody in
                          must not be a way to skip the question the door asks. */}
                      {verdict ? (
                        <p
                          className={`text-sm font-bold ${
                            verdict.admitted ? "text-emerald-300" : "text-red-300"
                          }`}
                        >
                          {verdict.admitted ? "ADMITTED TODAY" : "NOT VALID TODAY"}
                        </p>
                      ) : null}
                    </div>
                    {row.checked_in_at ? (
                      <span className="shrink-0 text-sm text-gray-400">Checked in</span>
                    ) : (
                      <button
                        type="button"
                        disabled={lookupBusy === row.id}
                        onClick={() => void manualCheckIn(row.id)}
                        className="min-h-12 shrink-0 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-50"
                      >
                        {lookupBusy === row.id ? "…" : "Check in"}
                      </button>
                    )}
                  </div>
                );
              })
                )}
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* Line the badge up here. A square to aim at makes the camera read
          faster and more reliably than a code held anywhere in frame. */}
      {cameraState === "active" && !panelOpen ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div
            className="aspect-square w-[min(60vw,60vh)] rounded-2xl border-4 border-white/90"
            style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
          />
          <p className="mt-4 rounded-full bg-black/60 px-4 py-2 text-base font-medium text-white">
            Hold the badge&apos;s code inside the square
          </p>
        </div>
      ) : null}

      {/* What just happened, bottom left — the + menu owns bottom right. */}
      {scanResult || pendingScans.length > 0 ? (
        <div className="absolute bottom-6 left-6 flex flex-col gap-2">
          {scanResult ? (
            <p
              className={`rounded-full bg-white px-4 py-2 text-base font-semibold ${
                SCAN_STATUS_COPY[scanResult]?.className ?? "text-gray-800"
              }`}
            >
              {SCAN_STATUS_COPY[scanResult]?.title ?? "Scan"}
            </p>
          ) : null}
          {pendingScans.length > 0 ? (
            <p className="rounded-full bg-purple-600 px-4 py-2 text-base font-semibold text-white">
              {pendingScans.length} queued
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Camera: switch, pick or retry. */}
      {cameraPanelOpen ? (
        <div className="absolute bottom-28 right-6 w-[min(360px,90vw)] rounded-2xl border border-white/20 bg-black/90 p-4">
          <div className="flex items-center justify-between">
            <p className="text-base font-semibold text-white">Camera</p>
            <button
              type="button"
              onClick={() => setCameraPanelOpen(false)}
              className="min-h-12 rounded-lg border border-white/40 px-4 text-base text-white"
            >
              Close
            </button>
          </div>
          {cameraError ? <p className="mt-2 text-sm text-amber-200">{cameraError}</p> : null}
          <div className="mt-3 flex flex-col gap-2">
            {cameraDevices.map((device, index) => (
              <button
                key={device.deviceId}
                type="button"
                onClick={() => {
                  setSelectedCameraId(device.deviceId);
                  setCameraPanelOpen(false);
                }}
                className={`min-h-12 rounded-lg px-4 text-left text-base ${
                  device.deviceId === selectedCameraId
                    ? "bg-white font-semibold text-black"
                    : "border border-white/40 text-white"
                }`}
              >
                {device.label || `Camera ${index + 1}`}
              </button>
            ))}
            {cameraState !== "active" ? (
              <button
                type="button"
                onClick={() => {
                  setCameraPanelOpen(false);
                  void startCameraScanner();
                }}
                className="min-h-12 rounded-lg bg-white px-4 text-base font-semibold text-black"
              >
                Try the camera again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ⛔ The desk's tools, under a + exactly like the site's toolkit (the
          same components), bigger and labelled for fingers on an iPad. */}
      <div className="absolute bottom-6 right-6 z-30 flex flex-col-reverse items-end gap-3">
        <ToolkitFabButton
          size="lg"
          expanded={deskMenuOpen}
          onClick={() => setDeskMenuOpen((open) => !open)}
          title={deskMenuOpen ? "Close desk tools" : "Open desk tools"}
        />
        {deskMenuOpen ? (
          <div className="flex flex-col items-end gap-3">
            <ToolButton
              size="lg"
              showLabel
              icon={<CameraIcon />}
              label="Camera"
              onClick={() => {
                setDeskMenuOpen(false);
                setLookupOpen(false);
                setCameraPanelOpen(true);
              }}
            />
            <ToolButton
              size="lg"
              showLabel
              icon={<SearchIcon />}
              label="Find a person or company"
              onClick={() => {
                setDeskMenuOpen(false);
                setCameraPanelOpen(false);
                setLookupOpen(true);
                setNameLookup("");
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.8 6.2 8 4.5h8l1.2 1.7H20A1.5 1.5 0 0 1 21.5 7.7v10.8A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5V7.7A1.5 1.5 0 0 1 4 6.2h2.8Z"
      />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

/**
 * Does what was typed into Find look like a badge code rather than a name?
 * One unbroken run of 16+ characters with no @ — names have spaces or are
 * short, emails have an @.
 */
function looksLikeBadgeCode(value: string): boolean {
  const v = value.trim();
  return v.length >= 16 && !/\s/.test(v) && !v.includes("@");
}
