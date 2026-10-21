"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { todayVerdict, type OpenSeat } from "@/lib/conference/badges/checkin";
import { addConferenceAttendee, allocateSeat } from "@/lib/actions/conference-entity-commerce";
import { listDeskCompanyContacts, recordNameOnlyWalkUp } from "@/lib/actions/conference-people";
import {
  loadReprintPreview,
  sendReprintToQueue,
  type BadgeReprintReason,
  type ReprintPreview,
} from "@/lib/actions/conference-badges";
import { updateField } from "@/lib/actions/update-field";
import { ToolButton, ToolkitFabButton } from "@/components/ui/ToolkitFab";
import DeskSellPanel, { type DeskSellContext } from "@/components/admin/conference/DeskSellPanel";
import { DeskPinCheck, DeskPinSetup, endHandOver, readHandOver } from "@/components/admin/conference/DeskPinPad";
import { getDeskPinState } from "@/lib/actions/desk-pin";
import { shortDay } from "@/lib/conference/desk-offers";
import {
  doorChoiceStillValid,
  doorChoiceUntil,
  doorCookieName,
  doorEventsOpenNow,
  doorWindow,
  parseDoorChoice,
  serializeDoorChoice,
  type DoorChoice,
  type DoorEvent,
} from "@/lib/conference/door";
import { cancelDeskCheckout, getDeskSaleStatus } from "@/lib/actions/desk-sale";

type ConferencePerson = {
  id: string;
  organization_id: string | null;
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
  /** The cards that exist for them (reprint-plan cardsOnHand). */
  reprintCards?: { companyBlank: boolean; spareCount: number; spareLabel: string | null; typeName: string | null };
};

type PendingScan = {
  qr_token: string;
  scan_timestamp: string;
  device_id?: string;
  /** The event this device was at when the badge was scanned (door mode). */
  entity_id?: string;
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
  /** What the server actually said, under a "Something went wrong". */
  detail?: string | null;
  /**
   * A reprint's job: the card offers "Send to printer" (the print station
   * beside the QL, which prints each sticker at its exact length).
   */
  printJob?: { jobId: string; labelPrintable: boolean; queued: boolean } | null;
};

const POLL_MS = 30_000;
const SCAN_PULSE_TTL_MS = 30_000;
const SCAN_PULSE_LIMIT = 3;
const PENDING_SCAN_STORAGE_PREFIX = "check-in-desk-pending-scans";

const SCAN_STATUS_COPY: Record<
  string,
  { title: string; description: string; className: string }
> = {
  // ⛔ Plain words, for a volunteer with a queue: what happened and what to do.
  // Never "token": nobody at a desk knows what one is.
  valid: {
    title: "Checked in",
    description: "Good to go. Hand them their badge.",
    className: "text-emerald-700",
  },
  already_checked_in: {
    title: "Already checked in",
    description: "This badge was picked up earlier. Make sure it is really them.",
    className: "text-accent",
  },
  invalid_token: {
    title: "Not one of our badges",
    description: "This code is not a badge for this conference. Find them by name instead.",
    className: "text-amber-700",
  },
  revoked_token: {
    title: "This badge was replaced",
    description: "They may have a newer badge. Find them by name.",
    className: "text-amber-700",
  },
  not_found: {
    title: "We can't find who this belongs to",
    description: "Nothing was checked in. Find them by name instead.",
    className: "text-amber-700",
  },
  // ⛔ Refused, not warned: a badge for another day does not get them in.
  not_valid_today: {
    title: "Not valid today",
    description: "Their badge does not cover today, so nothing was checked in.",
    className: "text-red-700",
  },
  legal_not_accepted: {
    title: "Documents not accepted",
    description: "An old result. Check-in no longer waits on documents.",
    className: "text-amber-700",
  },
  queued_offline: {
    title: "Saved, no connection",
    description: "It will send when the connection is back.",
    className: "text-purple-700",
  },
  scan_failed: {
    title: "Something went wrong",
    description: "Nothing was checked in. Try again.",
    className: "text-red-700",
  },
  // ⛔ Its own state, not "valid": no badge was scanned, and the desk's own
  // record of what happened should not say otherwise.
  manual_checked_in: {
    title: "Checked in by name",
    description: "No badge scanned. Checked in by hand and recorded against you.",
    className: "text-emerald-700",
  },
  // A reprint planned as the FULL colour badge: no card in hand to put a
  // sticker on. The label printer cannot print it.
  reprint_needs_full_badge: {
    title: "Needs the full badge",
    description: "The label printer only prints stickers. Reprint again and pick the card you're holding.",
    className: "text-amber-700",
  },
  badge_reprinted: {
    title: "Sent to the printer",
    description: "The stickers print at the laptop beside the printer.",
    className: "text-cyan-700",
  },
  // A desk sale landed: they hold a registration now. The card prints it.
  sale_paid: {
    title: "Paid: ready to print",
    description: "Their registration is paid. Print their badge.",
    className: "text-emerald-700",
  },
  sale_invoiced: {
    title: "Invoiced: ready to print",
    description: "Their company has been invoiced. Print their badge.",
    className: "text-emerald-700",
  },
  // At an event's door: in the room, but the event is not on their ticket.
  // Let in and invoiced (enforcement off) — the card offers the sale.
  not_on_ticket: {
    title: "Not on their ticket",
    description: "Let them in. This event isn't on their registration, so sell it to them.",
    className: "text-amber-700",
  },
  // A hand-over came back without a payment. The card link is closed.
  sale_not_paid: {
    title: "Not paid",
    description: "The card payment did not go through, so nothing was sold. Sell again or invoice the company.",
    className: "text-red-700",
  },
  // A walk-up named to a seat their company already owns. Not a check-in and
  // not a print: the operator reprints from this card onto the company blank.
  seat_named: {
    title: "Named and checked in",
    description: "Named to a seat their company already holds, and checked in. Check the badge, then print it.",
    className: "text-emerald-700",
  },
};

/**
 * How loud a result is. ⛔ One map drives the flash, the sound and the card's
 * colour, so they cannot disagree about whether to stop somebody.
 */
type ScanTone = "go" | "check" | "stop" | "info";
const SCAN_TONE: Record<string, ScanTone> = {
  valid: "go",
  manual_checked_in: "go",
  seat_named: "go",
  sale_paid: "go",
  sale_invoiced: "go",
  already_checked_in: "check",
  not_on_ticket: "check",
  reprint_needs_full_badge: "check",
  invalid_token: "stop",
  revoked_token: "stop",
  not_found: "stop",
  not_valid_today: "stop",
  legal_not_accepted: "stop",
  scan_failed: "stop",
  sale_not_paid: "stop",
  queued_offline: "info",
  badge_reprinted: "info",
};
const toneOf = (state: string): ScanTone => SCAN_TONE[state] ?? "info";
/**
 * A card that waits for a tap. Every stop, plus "not on their ticket": it is
 * amber (they are let in) but somebody has to make the sale, so it must not
 * fade before the operator gets to it.
 */
const staysUntilTapped = (state: string, card?: Pick<ScanPulseCard, "printJob">): boolean =>
  toneOf(state) === "stop" ||
  state === "not_on_ticket" ||
  state === "reprint_needs_full_badge" ||
  Boolean(card?.printJob);

const TONE_STYLE: Record<ScanTone, { header: string; flash: string }> = {
  go: { header: "bg-emerald-600 text-white", flash: "bg-emerald-500" },
  check: { header: "bg-amber-400 text-black", flash: "bg-amber-400" },
  stop: { header: "bg-red-600 text-white", flash: "bg-red-600" },
  info: { header: "bg-gray-700 text-white", flash: "bg-transparent" },
};

/**
 * A short tone and a buzz for each result, so the operator hears a stop while
 * looking at the person, not the screen. iPads cannot vibrate; the sound does.
 */
function signalResult(tone: ScanTone, audio: { current: AudioContext | null }) {
  const pattern: Record<ScanTone, number[]> = {
    go: [60],
    check: [60, 80, 60],
    stop: [220, 120, 220],
    info: [],
  };
  if (pattern[tone].length && typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern[tone]);
  }
  const ctx = audio.current;
  if (!ctx || tone === "info") return;
  const beeps: Array<[number, number, number]> =
    tone === "go"
      ? [[880, 0, 0.12]]
      : tone === "check"
        ? [[660, 0, 0.1], [660, 0.16, 0.1]]
        : [[220, 0, 0.18], [196, 0.26, 0.28]];
  for (const [freq, at, dur] of beeps) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone === "stop" ? "square" : "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + at);
    osc.stop(ctx.currentTime + at + dur + 0.02);
  }
}

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
  /** Timed events, for the door picker (lib/conference/door.ts). */
  doorEvents: DoorEvent[];
  /** The venue's timezone: an event's window is on its clock. */
  timeZone: string;
  /** Rehearsal only: pretend it is this instant for the door picker. */
  doorNow: string | null;
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
  doorEvents,
  timeZone,
  doorNow,
}: CheckInDeskClientProps) {
  const [rows, setRows] = useState<ConferencePerson[]>(initialRows);
  const [facts, setFacts] = useState<Record<string, CheckInFacts>>(initialFacts);
  const [openSeats, setOpenSeats] = useState<OpenSeat[]>(initialOpenSeats);
  // Recovery from a scan that did not resolve — see FAILED_SCAN_STATES.
  const [nameLookup, setNameLookup] = useState("");
  const [lookupOpen, setLookupOpen] = useState(false);
  // The full-screen colour for the latest result, and the sound for it.
  const [flash, setFlash] = useState<{ tone: ScanTone; key: number } | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  // ⛔ Browsers (iPad Safari above all) only allow sound after a tap, so the
  // first touch anywhere on the desk switches it on.
  const unlockAudio = useCallback(() => {
    if (!audioRef.current && typeof window !== "undefined" && "AudioContext" in window) {
      audioRef.current = new AudioContext();
    }
    void audioRef.current?.resume();
  }, []);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 700);
    return () => window.clearTimeout(t);
  }, [flash]);
  // Selling, inside the desk — carrying in whatever the desk already knows.
  const [sellContext, setSellContext] = useState<DeskSellContext | null>(null);
  const openSell = useCallback((context: DeskSellContext) => {
    setLookupOpen(false);
    setCameraPanelOpen(false);
    setDeskMenuOpen(false);
    setSellContext(context);
  }, []);
  // ── The event door (lib/conference/door.ts) ─────────────────────────────
  // ⛔ This desk with an event picked, not a second desk. The pick lives in a
  // cookie on THIS device until the event's window closes. "" = badge pickup,
  // chosen on purpose (so the desk stops asking until the window passes).
  const doorClock = useCallback(() => (doorNow ? new Date(doorNow) : new Date()), [doorNow]);
  const [doorChoice, setDoorChoice] = useState<DoorChoice | null>(null);
  const [doorPicker, setDoorPicker] = useState<"auto" | "manual" | null>(null);
  const activeDoorEvent = doorChoice?.entityId
    ? doorEvents.find((event) => event.id === doorChoice.entityId) ?? null
    : null;
  // Read by the camera's callback, which is created once — see lookupOpenRef.
  const doorEntityRef = useRef<string | null>(null);
  useEffect(() => {
    doorEntityRef.current = activeDoorEvent?.id ?? null;
  }, [activeDoorEvent]);
  const rememberDoor = useCallback(
    (event: DoorEvent | null) => {
      const now = doorClock();
      const until = event
        ? doorChoiceUntil(event, now, timeZone)
        : new Date(
            Math.max(
              now.getTime() + 2 * 60 * 60 * 1000,
              ...doorEventsOpenNow(doorEvents, now, timeZone).map((e) => doorWindow(e, timeZone).closes)
            )
          ).toISOString();
      const choice: DoorChoice = { entityId: event?.id ?? "", until };
      const maxAge = Math.max(60, Math.round((Date.parse(until) - now.getTime()) / 1000));
      document.cookie = `${doorCookieName(conferenceId)}=${serializeDoorChoice(choice)}; path=/admin/conference/${conferenceId}; max-age=${maxAge}; samesite=lax`;
      setDoorChoice(choice);
      setDoorPicker(null);
    },
    [conferenceId, doorClock, doorEvents, timeZone]
  );
  const sellForPerson = useCallback(
    (personId: string) => {
      const person = rows.find((r) => r.id === personId) ?? null;
      openSell({
        personId,
        personName: person?.display_name ?? person?.contact_email ?? null,
        organizationId: person?.organization_id ?? null,
        doorEventId: doorEntityRef.current,
      });
    },
    [openSell, rows]
  );
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
    (
      state: string,
      personId: string | null,
      detail: string | null = null,
      printJob: ScanPulseCard["printJob"] = null
    ) => {
      const person = personId ? rows.find((row) => row.id === personId) ?? null : null;
      const createdAt = Date.now();
      const card: ScanPulseCard = {
        id: `${createdAt}:${personId ?? "none"}:${Math.random().toString(36).slice(2, 8)}`,
        state,
        personId,
        // ⛔ A stop stays until someone taps it: a refusal that disappears on a
        // timer is a refusal nobody saw.
        expiresAt: staysUntilTapped(state, { printJob }) ? Number.POSITIVE_INFINITY : createdAt + SCAN_PULSE_TTL_MS,
        displayName: person?.display_name ?? person?.contact_email ?? null,
        facts: personId ? facts[personId] ?? null : null,
        checkedInAt: person?.checked_in_at ?? null,
        badgePrintStatus: person?.badge_print_status ?? null,
        hotelName: person?.hotel_name ?? null,
        hotelConfirmationCode: person?.hotel_confirmation_code ?? null,
        travelMode: person?.travel_mode ?? null,
        detail,
        printJob,
      };
      setScanCards((prev) => {
        const next = [card, ...prev];
        const stops = next.filter((c) => staysUntilTapped(c.state, c));
        const rest = next.filter((c) => toneOf(c.state) !== "stop").slice(0, SCAN_PULSE_LIMIT);
        return next.filter((c) => stops.includes(c) || rest.includes(c));
      });
      // The whole screen says it, and so does the speaker.
      setFlash({ tone: toneOf(state), key: createdAt });
      signalResult(toneOf(state), audioRef);

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

  // ⛔ The desk PIN (lib/conference/desk-pin.ts). Until it is known whether this
  // person has one, and whether the iPad is coming back from a hand-over, the
  // desk stays covered — a returning iPad must never flash open.
  const [pinState, setPinState] = useState<{ hasPin: boolean; mayChoose: boolean } | null>(null);
  const [handOverOrderId, setHandOverOrderId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void getDeskPinState(conferenceId).then((res) => {
      if (!live) return;
      setHandOverOrderId(readHandOver(conferenceId));
      // The door: keep a pick that is still good; otherwise ask, but only when
      // an event's window is open now.
      const cookieName = `${doorCookieName(conferenceId)}=`;
      const stored = parseDoorChoice(
        document.cookie.split("; ").find((part) => part.startsWith(cookieName))?.slice(cookieName.length)
      );
      const now = doorClock();
      const stillGood =
        stored !== null &&
        (stored.entityId === ""
          ? Date.parse(stored.until) > now.getTime()
          : doorChoiceStillValid(stored, doorEvents, now));
      if (stillGood) setDoorChoice(stored);
      else if (doorEventsOpenNow(doorEvents, now, timeZone).length > 0) setDoorPicker("auto");
      // A refused read leaves the desk usable but every PIN prompt will fail
      // closed on the server, which is where the decision lives anyway.
      setPinState(res.success ? { hasPin: res.data.hasPin, mayChoose: res.data.mayResetWithoutPin } : { hasPin: true, mayChoose: false });
    });
    return () => {
      live = false;
    };
  }, [conferenceId, doorClock, doorEvents, timeZone]);

  // Back from a hand-over and unlocked: what happened to the sale? Paid shows
  // the print cards; not paid closes the card link so it cannot be paid later.
  const settleHandOver = useCallback(
    async (orderId: string) => {
      const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const settled = async (rounds: number) => {
        for (let i = 0; i < rounds; i += 1) {
          const res = await getDeskSaleStatus({ conferenceId, orderId });
          if (res.success) {
            const { state, people } = res.data;
            if ((state === "paid" || state === "invoiced") && people.length > 0) {
              for (const person of people) pushScanCard(state === "paid" ? "sale_paid" : "sale_invoiced", person.personId);
              return true;
            }
            if (state === "canceled") {
              pushScanCard("sale_not_paid", null);
              return true;
            }
          }
          await sleep(2000);
        }
        return false;
      };
      if (await settled(4)) return;
      // ⛔ Closing fails when the card session already completed — someone paid
      // and the webhook is behind. Then keep waiting rather than call it unpaid.
      const closed = await cancelDeskCheckout({ conferenceId, orderId });
      if (closed.success) {
        pushScanCard("sale_not_paid", null);
        return;
      }
      if (await settled(10)) return;
      pushScanCard("scan_failed", null, "The card payment is not confirmed yet. Check the order before selling again.");
    },
    [conferenceId, pushScanCard]
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
        pushScanCard("scan_failed", null, "The rehearsal could not be reset.");
        return;
      }
      setScanCards([]);
      await Promise.all([loadTestCounts(), loadRows()]);
    } catch {
      pushScanCard("scan_failed", null, "The rehearsal could not be reset.");
    } finally {
      setResetBusy(false);
    }
  }, [conferenceId, loadTestCounts, loadRows, pushScanCard]);


  const submitScan = useCallback(
    async (
      scan: PendingScan,
      allowQueue: boolean
    ): Promise<{ state: string; personId: string | null }> => {
      try {
        const response = await fetch(`/api/admin/conference/${conferenceId}/check-in/scan`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...scan, test_mode: testMode, as_of: testMode ? asOf : null }),
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
    // that only bites once it stops being constant. Same for asOf.
    [conferenceId, testMode, asOf]
  );

  const submitToken = useCallback(
    async (token: string) => {
      const result = await submitScan(
        {
          qr_token: token,
          scan_timestamp: new Date().toISOString(),
          device_id: selectedCameraId || undefined,
          entity_id: doorEntityRef.current ?? undefined,
        },
        true
      );
      pushScanCard(result.state, result.personId);
      await loadRows();
    },
    [loadRows, pushScanCard, selectedCameraId, submitScan]
  );
  // ⛔ The camera reads the LATEST submitToken through this ref. It used to be
  // a dependency of startCameraScanner, and submitToken changes whenever the
  // roster refreshes (every 30s) or a scan lands, so the camera was torn down
  // and reopened each time: the webcam froze and went blank (2026-10-21).
  const submitTokenRef = useRef(submitToken);
  useEffect(() => {
    submitTokenRef.current = submitToken;
  }, [submitToken]);

  // ⛔ Camera starts run ONE AT A TIME. Two starts overlapping on one <video>
  // (page load does this) left the loser tearing down the winner's picture:
  // the desk showed nothing and said nothing (2026-10-21). Each start waits
  // for the last; one already superseded is skipped, and one superseded while
  // opening closes its own stream before the next is allowed to begin.
  const cameraGenRef = useRef(0);
  const cameraChainRef = useRef<Promise<void>>(Promise.resolve());
  const stopCameraScanner = useCallback(() => {
    cameraGenRef.current += 1;
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
    stopCameraScanner();
    setCameraState("requesting");
    const thisStart = cameraGenRef.current;
    const previous = cameraChainRef.current;
    let done: () => void = () => undefined;
    cameraChainRef.current = new Promise<void>((resolve) => {
      done = resolve;
    });
    await previous;
    if (thisStart !== cameraGenRef.current) {
      done();
      return;
    }

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
          await submitTokenRef.current(raw);
        }
      );
      if (thisStart !== cameraGenRef.current) {
        controls.stop();
        return;
      }
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
    } finally {
      done();
    }
  }, [refreshCameraDevices, selectedCameraId, stopCameraScanner]);

  /** A badge code put into Find: check in exactly as a camera scan would. */
  const checkInByCode = async () => {
    const code = nameLookup.trim();
    if (!code) return;
    setNameLookup("");
    setLookupOpen(false);
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
  /** Check somebody in by hand: the one request Find and Name someone share. */
  const checkInByHand = useCallback(
    async (personId: string): Promise<{ ok: boolean; state?: string; error?: string }> => {
      const response = await fetch(`/api/admin/conference/${conferenceId}/people/${personId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "manual_check_in", testMode, entityId: doorEntityRef.current }),
      });
      const payload = (await response.json()) as { error?: string; state?: string };
      return { ok: response.ok, state: payload.state, error: payload.error };
    },
    [conferenceId, testMode]
  );

  const manualCheckIn = useCallback(
    async (personId: string) => {
      setLookupBusy(personId);
      try {
        const payload = await checkInByHand(personId);
        if (!payload.ok) {
          pushScanCard("scan_failed", personId, payload.error ?? "They could not be checked in by name.");
          return;
        }
        // Announce it the same way a scan does, so the desk has one place to
        // look for "what just happened" regardless of how it happened — but
        // under its own state, because it is not what a scan did. At a door,
        // the result is the door's (not on their ticket, already in).
        pushScanCard(
          payload.state === "not_on_ticket" || payload.state === "already_checked_in"
            ? payload.state
            : "manual_checked_in",
          personId
        );
        setLookupOpen(false);
        setNameLookup("");
        await loadRows();
      } catch {
        pushScanCard("scan_failed", personId, "They could not be checked in by name.");
      } finally {
        setLookupBusy(null);
      }
    },
    [checkInByHand, pushScanCard, loadRows]
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
          // ⛔ Nobody holds a seat for them: not coming, no badge.
          row.person_kind !== "unassigned" &&
          ((row.display_name ?? "").toLowerCase().includes(q) ||
            (row.contact_email ?? "").toLowerCase().includes(q))
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
      // ⛔ At an event's door, a company's spare tickets to THAT event; at the
      // badge desk, its unnamed registrations. Never one for the other.
      if (activeDoorEvent ? seat.registrationTypeId !== activeDoorEvent.id : seat.entityKind !== "registration") continue;
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
  }, [activeDoorEvent, nameLookup, openSeats]);

  // The "name someone" form, open on one company at a time.
  const [namingOrgId, setNamingOrgId] = useState<string | null>(null);
  const [walkUpName, setWalkUpName] = useState("");
  const [walkUpEmail, setWalkUpEmail] = useState("");
  const [walkUpTypeId, setWalkUpTypeId] = useState<string>("");
  const [namingBusy, setNamingBusy] = useState(false);
  const [namingError, setNamingError] = useState<string | null>(null);
  // The known person picked from the company's own contacts, if any.
  const [walkUpContactId, setWalkUpContactId] = useState<string | null>(null);
  const [companyContacts, setCompanyContacts] = useState<
    Record<string, Array<{ id: string; name: string; email: string | null; title: string | null }>>
  >({});
  useEffect(() => {
    if (!namingOrgId || companyContacts[namingOrgId]) return;
    const orgId = namingOrgId;
    void listDeskCompanyContacts({ conferenceId, organizationId: orgId }).then((res) => {
      setCompanyContacts((prev) => ({ ...prev, [orgId]: res.success ? res.data : [] }));
    });
  }, [companyContacts, conferenceId, namingOrgId]);
  const contactSuggestions = useMemo(() => {
    if (!namingOrgId || walkUpContactId) return [];
    const typed = walkUpName.trim().toLowerCase();
    return (companyContacts[namingOrgId] ?? [])
      .filter((c) => !typed || c.name.toLowerCase().includes(typed))
      .slice(0, 6);
  }, [companyContacts, namingOrgId, walkUpContactId, walkUpName]);

  /**
   * Name a walk-up to one of their company's open seats.
   *
   * ⛔ The SAME two calls the company's own seat matrix makes on their org page:
   * addConferenceAttendee (reuses an existing person for that email) then
   * allocateSeat. No desk-only write. The card that follows carries the reprint
   * control, and its suggestion will be the company blank.
   */
  const nameWalkUp = useCallback(
    async (org: {
      organizationId: string;
      organizationName: string;
      types: Array<{ typeId: string; name: string; seatIds: string[] }>;
    }) => {
      const type = org.types.find((t) => t.typeId === walkUpTypeId) ?? org.types[0];
      const seatId = type?.seatIds[0];
      if (!seatId || !walkUpName.trim()) return;
      // A company's spare EVENT ticket, named at that event's door: no badge.
      const eventTicket = openSeats.find((seat) => seat.seatId === seatId)?.entityKind === "event";
      setNamingBusy(true);
      setNamingError(null);
      try {
        const added = await addConferenceAttendee(conferenceId, org.organizationId, {
          displayName: walkUpName.trim(),
          contactEmail: walkUpEmail.trim() || null,
          // A known contact is seated as themselves, never re-found by email.
          contactId: walkUpContactId,
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
        // ⛔ No email: they still get a person record (or the badge cannot
        // print) but no login, and their company's admins are told.
        // The seat is already theirs, so a failure here must not send the
        // operator round again (a name-only retry would add a second person).
        let recordProblem: string | null = null;
        if (!walkUpEmail.trim() && !walkUpContactId) {
          const recorded = await recordNameOnlyWalkUp({ conferenceId, conferencePersonId: added.data.id });
          if (!recorded.success) recordProblem = `Their badge may not print yet: ${recorded.error}`;
        }
        // ⛔ They are standing at the desk: naming them IS checking them in
        // (Stephen, 2026-10-21). The same hand check-in Find uses.
        const checkedIn: { ok: boolean; state?: string; error?: string } = await checkInByHand(added.data.id).catch(() => ({
          ok: false,
        }));
        if (!checkedIn.ok) {
          recordProblem = [recordProblem, `Named, but not checked in: ${checkedIn.error ?? "try Find"}.`]
            .filter(Boolean)
            .join(" ");
        }
        setNamingOrgId(null);
        setWalkUpName("");
        setWalkUpEmail("");
        setWalkUpContactId(null);
        setNameLookup("");
        setLookupOpen(false);
        if (eventTicket) {
          // In the room on their company's ticket. An event ticket has no
          // badge, so nothing prints; the card says whose ticket it was.
          pushScanCard(
            checkedIn.ok ? checkedIn.state ?? "valid" : "seat_named",
            added.data.id,
            [`On ${org.organizationName}'s ${type.name} ticket.`, recordProblem].filter(Boolean).join(" ")
          );
          return;
        }
        // ⛔ Naming them at the desk PRINTS their badge (Stephen, 2026-10-21):
        // no second tap. The card is the desk's own suggestion for them (a
        // company blank, else a spare), read fresh because they are new here.
        let stock: "company_blank" | "spare" | "none" | undefined;
        try {
          const factsResponse = await fetch(`/api/admin/conference/${conferenceId}/check-in/facts`, {
            cache: "no-store",
          });
          if (factsResponse.ok) {
            const fresh = (await factsResponse.json()) as { facts?: Record<string, CheckInFacts> };
            stock = fresh.facts?.[added.data.id]?.reprintStock;
          }
        } catch {
          // No suggestion: the print path plans it as a full badge and says so.
        }
        if (recordProblem) pushScanCard("seat_named", added.data.id, recordProblem);
        const printed = await reprintBadgeRef.current(
          added.data.id,
          "ops_override",
          "First badge, named at the desk",
          stock
        );
        // If the print did not go, the named card stays with its Print badge.
        if (!printed && !recordProblem) pushScanCard("seat_named", added.data.id, null);
      } catch {
        setNamingError("Could not name them to that seat. Try again.");
      } finally {
        setNamingBusy(false);
      }
    },
    [checkInByHand, conferenceId, openSeats, pushScanCard, walkUpContactId, walkUpEmail, walkUpName, walkUpTypeId]
  );

  /**
   * Reprint, in one tap, with the reason already chosen.
   *
   * ⛔ This used to be two `window.prompt` dialogs — the first asking the
   * operator to TYPE one of four snake_case enum values from memory, with a
   * silent failure if they typed anything else. That is a developer's debug
   * affordance standing in for a desk control, at a desk, with a queue.
   */
  // ⛔ The card the operator is HOLDING decides the print (reprint-plan.ts):
  // the desk only guesses, so they say. Kept per person until the page reloads.
  const [cardInHand, setCardInHand] = useState<Record<string, "company_blank" | "spare" | "none">>({});
  const cardInHandRef = useRef(cardInHand);
  useEffect(() => {
    cardInHandRef.current = cardInHand;
  }, [cardInHand]);
  const cardInHandPicker = (personId: string) => {
    // ⛔ Only cards that EXIST for this person: a blank printed for their
    // company AND their type, or a spare of their type. Another type's card
    // carries another type's schedule on its back.
    const cards = facts[personId]?.reprintCards;
    const type = cards?.typeName ? ` (${cards.typeName})` : "";
    // In a rehearsal every card is offered, so printing can be tried on the
    // test badges without changing the conference's print-stock settings.
    const options: Array<["company_blank" | "spare" | "none", string]> = [
      ...(cards?.companyBlank || testMode ? [["company_blank", `Company blank${type}`] as ["company_blank", string]] : []),
      // A spare fits anyone whose badge looks the same; the desk prints their
      // schedule on a sticker, so it is named by its stack, not a type.
      ...((cards && cards.spareCount > 0) || testMode
        ? [["spare", cards?.spareLabel ? `Spare (${cards.spareLabel.toLowerCase()})` : "Spare"] as ["spare", string]]
        : []),
      ["none", "No card"],
    ];
    const suggested = facts[personId]?.reprintStock ?? "none";
    const chosen =
      cardInHand[personId] ?? (options.some(([value]) => value === suggested) ? suggested : "none");
    return (
      <div className="mt-2">
        <p className="text-sm text-gray-200">Which card are you holding?</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {options.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setCardInHand((prev) => ({ ...prev, [personId]: value }))}
              className={`min-h-12 rounded-lg px-3 text-sm font-semibold ${
                chosen === value ? "bg-emerald-400 text-black" : "border border-white/40 text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {options.length === 1 ? (
          <p className="mt-1 text-xs text-amber-200">
            No blank or spare was printed that fits them, so there is no card for a sticker. The label printer
            can&apos;t print a full badge.
          </p>
        ) : chosen === "none" ? (
          <p className="mt-1 text-xs text-amber-200">No card: the label printer can&apos;t print a full badge.</p>
        ) : null}
      </div>
    );
  };

  const reprintBadge = useCallback(
    // ops_override is the desk's FIRST print for someone it just sold to — not
    // one of the operator's reprint reasons, so it carries a note saying so.
    async (
      personId: string,
      reason: BadgeReprintReason,
      note?: string,
      // A caller that already knows the card (Name to seat), before the desk's
      // own facts for a brand-new person have loaded.
      knownStock?: "company_blank" | "spare" | "none"
    ): Promise<boolean> => {
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
            ...(note ? { reprintNote: note } : {}),
            // What the operator says they are holding, else the desk's guess.
            stockInHand: cardInHandRef.current[personId] ?? knownStock ?? facts[personId]?.reprintStock,
          }),
        });
        const payload = (await response.json()) as {
          error?: string;
          badgePrintJobId?: string;
          labelPrintable?: boolean;
        };
        if (!response.ok) {
          pushScanCard("scan_failed", personId, payload.error ?? "The reprint could not be sent.");
          return false;
        }
        if (payload.labelPrintable === true && payload.badgePrintJobId) {
          // ⛔ One tap prints (Stephen, 2026-10-21): the reprint goes straight
          // to the print station, no second "Send to printer".
          const sent = await sendReprintToQueue({ conferenceId, jobId: payload.badgePrintJobId });
          pushScanCard(
            sent.success ? "badge_reprinted" : "scan_failed",
            personId,
            !sent.success
              ? sent.error
              : sent.data.stationOnline
                ? null
                : "Sent, but the printer laptop is offline. Start CSC Print Station on the laptop by the printer.",
            { jobId: payload.badgePrintJobId, labelPrintable: true, queued: sent.success }
          );
          setReprintOpenId(null);
          if (!sent.success) return false;
        } else {
          pushScanCard(
            "reprint_needs_full_badge",
            personId,
            "No company blank or spare card was picked, so this was planned as the full colour badge."
          );
        }
        await loadRows();
        return true;
      } catch {
        pushScanCard("scan_failed", personId, "The reprint could not be sent.");
        return false;
      } finally {
        setReprintBusy(null);
      }
    },
    [conferenceId, facts, loadRows, pushScanCard]
  );
  // Name to seat is declared above this, so it reaches the print through a ref.
  const reprintBadgeRef = useRef(reprintBadge);
  useEffect(() => {
    reprintBadgeRef.current = reprintBadge;
  }, [reprintBadge]);

  /**
   * The reprint preview: what will print, editable in place (Stephen,
   * 2026-10-21). A corrected name or title saves to the person's contact
   * record through updateField, with the desk's permission and no Circle push.
   */
  const [reprintDrafts, setReprintDrafts] = useState<
    Record<string, { preview: ReprintPreview | null; error: string | null; first: string; last: string; title: string }>
  >({});
  const loadingDraftsRef = useRef(new Set<string>());
  const ensureReprintDraft = useCallback(
    async (personId: string) => {
      if (loadingDraftsRef.current.has(personId)) return;
      loadingDraftsRef.current.add(personId);
      const res = await loadReprintPreview({ conferenceId, personId });
      setReprintDrafts((prev) => ({
        ...prev,
        [personId]: res.success
          ? { preview: res.data, error: null, first: res.data.firstName, last: res.data.lastName, title: res.data.roleTitle }
          : { preview: null, error: res.error, first: "", last: "", title: "" },
      }));
    },
    [conferenceId]
  );

  // ⛔ A card being corrected must not time out under the operator's fingers:
  // touching the reprint panel keeps it until Print or Dismiss.
  const pinCard = useCallback((cardId: string) => {
    setScanCards((prev) =>
      prev.map((card) => (card.id === cardId ? { ...card, expiresAt: Number.POSITIVE_INFINITY } : card))
    );
  }, []);

  const printReprint = useCallback(
    async (personId: string, cardId: string, firstBadge = false) => {
      const draft = reprintDrafts[personId];
      const preview = draft?.preview;
      if (!draft || !preview) return;
      const changes = (
        [
          ["first_name", draft.first.trim(), preview.firstName],
          ["last_name", draft.last.trim(), preview.lastName],
          ["role_title", draft.title.trim(), preview.roleTitle],
        ] as const
      ).filter(([, next, before]) => next !== before.trim());
      if (changes.length > 0 && preview.contactId) {
        setReprintBusy(personId);
        for (const [column, next] of changes) {
          const saved = await updateField({
            table: "contacts",
            column,
            entityId: preview.contactId,
            newValue: next || null,
            deskConferenceId: conferenceId,
          });
          if (!saved.success) {
            setReprintBusy(null);
            pushScanCard("scan_failed", personId, saved.error ?? "The name could not be saved.");
            return;
          }
        }
        // Read back what was saved, so a second reprint starts from it.
        loadingDraftsRef.current.delete(personId);
        void ensureReprintDraft(personId);
      }
      // ⛔ No reason to pick: an edit IS the reason, and otherwise the desk
      // cannot tell damaged from lost without asking, so it does not ask.
      // A first badge is not a reprint, and is not filed as a name change.
      const printed = firstBadge
        ? await reprintBadge(personId, "ops_override", "First badge, named at the desk")
        : await reprintBadge(
            personId,
            changes.length > 0 ? "name_change" : "ops_override",
            changes.length > 0 ? undefined : "Reprint at the desk"
          );
      // The new "Sent to the printer" card replaces the one it was printed from.
      if (printed) setScanCards((prev) => prev.filter((card) => card.id !== cardId));
    },
    [conferenceId, ensureReprintDraft, pushScanCard, reprintBadge, reprintDrafts]
  );

  const reprintPanel = (personId: string, cardId: string, firstBadge = false) => {
    const draft = reprintDrafts[personId];
    if (!draft) return <p className="mt-2 text-sm text-gray-300">Loading their badge…</p>;
    if (draft.error || !draft.preview) {
      return <p className="mt-2 text-sm text-amber-200">{draft.error ?? "Their badge could not be loaded."}</p>;
    }
    const editable = Boolean(draft.preview.contactId);
    const set = (field: "first" | "last" | "title") => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setReprintDrafts((prev) => ({ ...prev, [personId]: { ...prev[personId], [field]: value } }));
    };
    const field = "w-full rounded bg-transparent px-1 text-black focus:bg-amber-50 focus:outline-none";
    return (
      <div className="mt-2" onFocusCapture={() => pinCard(cardId)} onPointerDownCapture={() => pinCard(cardId)}>
        {/* What prints, as it prints. Tap a line to correct it. */}
        <div className="rounded-lg bg-white p-3 text-center text-black">
          <input
            aria-label="First name"
            value={draft.first}
            onChange={set("first")}
            disabled={!editable}
            className={`${field} text-center text-2xl font-bold uppercase`}
          />
          <input
            aria-label="Last name"
            value={draft.last}
            onChange={set("last")}
            disabled={!editable}
            className={`${field} text-center text-lg`}
          />
          <input
            aria-label="Title"
            value={draft.title}
            onChange={set("title")}
            disabled={!editable}
            placeholder="No title"
            className={`${field} text-center text-sm`}
          />
          {draft.preview.organizationName ? (
            <p className="mt-1 text-sm font-semibold">{draft.preview.organizationName}</p>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {editable
            ? "Tap a line to correct it. A correction saves to their record."
            : "This badge has no contact record to correct."}
        </p>
        {cardInHandPicker(personId)}
        <button
          type="button"
          disabled={reprintBusy === personId}
          onClick={() => void printReprint(personId, cardId, firstBadge)}
          className="mt-2 min-h-12 w-full rounded-lg bg-white px-4 text-base font-semibold text-black disabled:opacity-50"
        >
          {reprintBusy === personId ? "…" : firstBadge ? "Print badge" : "Print"}
        </button>
      </div>
    );
  };

  // "Send to print queue": the laptop beside the QL prints it (print station).
  const sendToPrintQueue = useCallback(
    async (cardId: string, jobId: string) => {
      const res = await sendReprintToQueue({ conferenceId, jobId });
      if (!res.success) {
        pushScanCard("scan_failed", null, res.error);
        return;
      }
      setScanCards((prev) =>
        prev.map((card) =>
          card.id === cardId && card.printJob
            ? {
                ...card,
                printJob: { ...card.printJob, queued: true },
                // Nothing will print it until a station is running.
                detail: res.data.stationOnline
                  ? card.detail
                  : "Sent, but the printer laptop is offline. Start CSC Print Station on the laptop by the printer.",
              }
            : card
        )
      );
    },
    [conferenceId, pushScanCard]
  );

  /**
   * Their company's spare ticket to the event at this door, if it holds one
   * (Jenna at the door, 2026-10-21): somebody not on the event whose company
   * bought tickets nobody is named to goes on the company's ticket, not sold
   * another.
   */
  const spareTicketFor = (personId: string): OpenSeat | null => {
    if (!activeDoorEvent) return null;
    const orgId = rows.find((row) => row.id === personId)?.organization_id;
    if (!orgId) return null;
    return (
      openSeats.find(
        (seat) =>
          seat.entityKind === "event" && seat.registrationTypeId === activeDoorEvent.id && seat.organizationId === orgId
      ) ?? null
    );
  };
  const [spareBusy, setSpareBusy] = useState<string | null>(null);
  const takeCompanyTicket = useCallback(
    async (cardId: string, personId: string, seat: OpenSeat) => {
      setSpareBusy(cardId);
      try {
        // The same allocateSeat the company's own seat matrix uses.
        const seated = await allocateSeat(seat.seatId, personId);
        if (!seated.success) {
          pushScanCard("scan_failed", personId, seated.error);
          return;
        }
        setOpenSeats((prev) => prev.filter((open) => open.seatId !== seat.seatId));
        setScanCards((prev) =>
          prev.map((card) =>
            card.id === cardId
              ? {
                  ...card,
                  state: "valid",
                  detail: `On ${seat.organizationName}'s ${seat.registrationTypeName} ticket.`,
                  expiresAt: Date.now() + SCAN_PULSE_TTL_MS,
                }
              : card
          )
        );
      } finally {
        setSpareBusy(null);
      }
    },
    [pushScanCard]
  );

  const activeCards = useMemo(
    () => scanCards.filter((card) => card.expiresAt > nowMs),
    [nowMs, scanCards]
  );

  // Load the preview for every open reprint: an already-checked-in scan opens
  // one on its own, any other card when Reprint Badge is tapped.
  useEffect(() => {
    for (const card of activeCards) {
      if (!card.personId) continue;
      if (card.state === "already_checked_in" || card.state === "seat_named" || reprintOpenId === card.id)
        void ensureReprintDraft(card.personId);
    }
  }, [activeCards, ensureReprintDraft, reprintOpenId]);

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

  // ⛔ Keep the camera alive (Stephen, 2026-10-21: coming back from an unpaid
  // sale froze it on iPad Safari). iOS pauses or mutes a camera stream around
  // a page coming back from Stripe, a PIN pad, the keyboard, the app being
  // backgrounded, and says nothing. Rather than guess which, the desk WATCHES
  // the picture: a stream that ended or went mute, or video that stopped
  // moving for ~6s while the desk is on screen, is restarted.
  const cameraStateRef = useRef(cameraState);
  useEffect(() => {
    cameraStateRef.current = cameraState;
  }, [cameraState]);
  const startCameraRef = useRef(startCameraScanner);
  useEffect(() => {
    startCameraRef.current = startCameraScanner;
  }, [startCameraScanner]);
  useEffect(() => {
    let lastTime = -1;
    let stalledTicks = 0;
    const restart = () => {
      stalledTicks = 0;
      lastTime = -1;
      void startCameraRef.current();
    };
    const watchdog = window.setInterval(() => {
      if (document.visibilityState !== "visible" || cameraStateRef.current !== "active") {
        stalledTicks = 0;
        return;
      }
      const video = videoRef.current;
      const track = (video?.srcObject as MediaStream | null)?.getVideoTracks?.()[0];
      if (!video || !track || track.readyState === "ended") return restart();
      // A paused element with a live track only needs to play again.
      if (video.paused) void video.play().catch(() => undefined);
      if (track.muted || video.currentTime === lastTime) {
        stalledTicks += 1;
        if (stalledTicks >= 3) restart();
      } else {
        stalledTicks = 0;
      }
      lastTime = video.currentTime;
    }, 2000);
    // Safari restoring the page from its back/forward cache runs no effects.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) restart();
    };
    const onVisible = () => {
      // Never after "denied" or "unsupported": that would re-ask, or fail, forever.
      const state = cameraStateRef.current;
      if (document.visibilityState === "visible" && (state === "idle" || state === "error")) restart();
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(watchdog);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    document.body.classList.add("check-in-kiosk");
    return () => {
      document.body.classList.remove("check-in-kiosk");
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden bg-black text-white" onPointerDown={unlockAudio}>
      {pinState === null ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-gray-950 text-lg text-gray-300">
          Opening the desk…
        </div>
      ) : !pinState.hasPin ? (
        <DeskPinSetup
          conferenceId={conferenceId}
          mayChoose={pinState.mayChoose}
          onDone={() => setPinState({ hasPin: true, mayChoose: pinState.mayChoose })}
        />
      ) : handOverOrderId ? (
        <DeskPinCheck
          conferenceId={conferenceId}
          title="Please hand the device back"
          subtitle="Staff: enter your PIN to unlock the desk."
          onPassed={() => {
            const orderId = handOverOrderId;
            endHandOver(conferenceId);
            setHandOverOrderId(null);
            void settleHandOver(orderId);
            // The device was in somebody else's hands and on Stripe: a fresh
            // camera, not whatever iOS left of the old one.
            void startCameraScanner();
          }}
        />
      ) : null}
      {/* ⛔ The door picker comes AFTER the PIN: it only shows once the desk is
          unlocked and nothing else is covering it. */}
      {pinState?.hasPin && !handOverOrderId && doorPicker ? (
        <DoorPicker
          events={doorEvents}
          openNow={doorEventsOpenNow(doorEvents, doorClock(), timeZone)}
          showAll={doorPicker === "manual"}
          activeId={activeDoorEvent?.id ?? null}
          onPick={rememberDoor}
          onClose={doorPicker === "manual" ? () => setDoorPicker(null) : null}
        />
      ) : null}
      {activeDoorEvent ? (
        <button
          type="button"
          onClick={() => setDoorPicker("manual")}
          className="absolute bottom-6 left-6 z-30 flex min-h-12 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black shadow-lg"
        >
          <CalendarIcon />
          At: {activeDoorEvent.name}
        </button>
      ) : null}
      {flash && flash.tone !== "info" ? (
        <div
          key={flash.key}
          aria-hidden
          className={`pointer-events-none absolute inset-0 z-50 animate-[desk-flash_700ms_ease-out_forwards] ${TONE_STYLE[flash.tone].flash}`}
        />
      ) : null}
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
        <div className="absolute inset-x-0 top-14 z-30 mx-auto max-h-[calc(100dvh-9rem)] w-[min(560px,94vw)] space-y-3 overflow-y-auto">
          {activeCards.map((card) => (
            <div key={card.id} className="overflow-hidden rounded-xl bg-black/85 text-base shadow-2xl">
              <div className={`px-4 py-3 ${TONE_STYLE[toneOf(card.state)].header}`}>
                <p className="text-xl font-bold">{SCAN_STATUS_COPY[card.state]?.title ?? "Scan result"}</p>
                <p className="mt-0.5 text-base">{SCAN_STATUS_COPY[card.state]?.description ?? card.state}</p>
                {/* What actually happened, when there is more to say than the
                    state's own line — a server error, why no sticker. */}
                {card.detail ? <p className="mt-1 text-sm font-semibold">{card.detail}</p> : null}
              </div>
              <div className="p-4">
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
                <div>
                  {/* The red header already says what happened; these are what to do. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setScanCards((prev) => prev.filter((entry) => entry.id !== card.id));
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
                      Find
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
              {/* Just named at the desk: their FIRST badge, printed from here. */}
              {card.state === "seat_named" && card.personId ? reprintPanel(card.personId, card.id, true) : null}
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
                            : "No blank or spare expected"}
                      </strong>{" "}
                      {card.facts.reprintReason}
                      {card.facts.reprintStock === "none"
                        ? ""
                        : " Check the pile first; print in full if it is empty."}
                    </p>
                  ) : null}
                  {reprintPanel(card.personId, card.id)}
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
                {card.personId && card.state !== "already_checked_in" && card.state !== "seat_named" ? (
                  <button
                    type="button"
                    onClick={() =>
                      {
                        setReprintOpenId((prev) => (prev === card.id ? null : card.id));
                        pinCard(card.id);
                      }
                    }
                    className="min-h-12 rounded-lg border border-white/40 px-4 text-sm font-medium text-white"
                  >
                    Reprint Badge
                  </button>
                ) : null}
              </div>
              {reprintOpenId === card.id && card.personId ? reprintPanel(card.personId, card.id) : null}
              {expandedCardId === card.id ? (
                <div className="mt-2 rounded border border-white/20 bg-black/50 p-2 text-sm text-gray-200">
                  <p>Email: {rows.find((r) => r.id === card.personId)?.contact_email ?? "n/a"}</p>
                  <p>Checked in: {card.checkedInAt ? "yes" : "no"}</p>
                  <p>Badge: {card.badgePrintStatus ?? "unknown"}</p>
                  <p>Hotel confirm: {card.hotelConfirmationCode ?? "n/a"}</p>
                </div>
              ) : null}
              {(card.state === "sale_paid" || card.state === "sale_invoiced") && card.personId ? (
                <button
                  type="button"
                  disabled={reprintBusy === card.personId}
                  onClick={() => void reprintBadge(card.personId as string, "ops_override", "First badge for a desk sale")}
                  className="mt-3 min-h-12 w-full rounded-lg bg-white px-4 text-base font-semibold text-black disabled:opacity-50"
                >
                  {reprintBusy === card.personId ? "…" : "Print badge"}
                </button>
              ) : null}
              {/* ⛔ One way to print: the print station beside the QL. A
                  browser's print dialog lets the printer driver override each
                  sticker's size (Stephen removed "Print now", 2026-10-21). */}
              {card.printJob?.labelPrintable ? (
                <button
                  type="button"
                  disabled={card.printJob.queued}
                  onClick={() => void sendToPrintQueue(card.id, card.printJob?.jobId as string)}
                  className="mt-3 min-h-12 w-full rounded-lg bg-white px-4 text-base font-semibold text-black disabled:opacity-60"
                >
                  {card.printJob.queued ? "Sent to the printer ✓" : "Send to printer"}
                </button>
              ) : null}
              {card.state === "not_on_ticket" && card.personId && spareTicketFor(card.personId) ? (
                <button
                  type="button"
                  disabled={spareBusy === card.id}
                  onClick={() =>
                    void takeCompanyTicket(card.id, card.personId as string, spareTicketFor(card.personId as string) as OpenSeat)
                  }
                  className="mt-3 min-h-12 w-full rounded-lg bg-white px-4 text-base font-semibold text-black disabled:opacity-50"
                >
                  {spareBusy === card.id
                    ? "…"
                    : `Use ${spareTicketFor(card.personId)?.organizationName}'s spare ticket`}
                </button>
              ) : null}
              {card.state === "not_on_ticket" && card.personId ? (
                <button
                  type="button"
                  onClick={() => sellForPerson(card.personId as string)}
                  className="mt-3 inline-flex min-h-12 items-center rounded-lg bg-white px-4 text-base font-semibold text-black"
                >
                  Sell it to them →
                </button>
              ) : null}
              {card.state === "not_valid_today" && card.personId ? (
                <button
                  type="button"
                  onClick={() => sellForPerson(card.personId as string)}
                  className="mt-3 inline-flex min-h-12 items-center rounded-lg bg-white px-4 text-base font-semibold text-black"
                >
                  Sell them a day pass →
                </button>
              ) : null}
              {staysUntilTapped(card.state, card) || card.expiresAt === Number.POSITIVE_INFINITY ? (
                <button
                  type="button"
                  onClick={() => setScanCards((prev) => prev.filter((entry) => entry.id !== card.id))}
                  className="mt-3 min-h-12 w-full rounded-lg border border-white/50 px-4 text-base font-semibold text-white"
                >
                  Dismiss
                </button>
              ) : (
                <p className="mt-2 text-sm text-gray-400">
                  {Math.max(0, Math.ceil((card.expiresAt - nowMs) / 1000))}s
                </p>
              )}
              </div>
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
                          {activeDoorEvent ? "Spare tickets:" : "Open seats:"}{" "}
                          {org.types.map((t) => `${t.name} × ${t.seatIds.length}`).join(", ")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openSell({ organizationId: org.organizationId })}
                        className="min-h-12 shrink-0 rounded-lg border border-white/50 px-4 text-sm font-semibold text-white"
                      >
                        Sell
                      </button>
                      {namingOrgId !== org.organizationId ? (
                        <button
                          type="button"
                          onClick={() => {
                            setNamingOrgId(org.organizationId);
                            setWalkUpContactId(null);
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
                          onChange={(event) => {
                            setWalkUpName(event.target.value);
                            // Typing again means somebody new, not the person picked.
                            if (walkUpContactId) {
                              setWalkUpContactId(null);
                              setWalkUpEmail("");
                            }
                          }}
                          placeholder="Their name"
                          className="min-h-12 w-full rounded-lg border border-white/40 bg-black px-4 text-sm text-white placeholder:text-gray-400"
                        />
                        {/* ⛔ Only this company's contacts (Stephen, 2026-10-21). */}
                        {contactSuggestions.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {contactSuggestions.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setWalkUpContactId(c.id);
                                  setWalkUpName(c.name);
                                  setWalkUpEmail(c.email ?? "");
                                }}
                                className="min-h-12 rounded-lg border border-white/40 px-3 text-left text-sm text-white"
                              >
                                {c.name}
                                {c.title ? <span className="block text-xs text-gray-400">{c.title}</span> : null}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {walkUpContactId ? (
                          <p className="text-xs text-emerald-200">Already one of their contacts: seated as themselves.</p>
                        ) : (
                          <input
                            value={walkUpEmail}
                            onChange={(event) => setWalkUpEmail(event.target.value)}
                            placeholder="Email (optional)"
                            className="min-h-12 w-full rounded-lg border border-white/40 bg-black px-4 text-sm text-white placeholder:text-gray-400"
                          />
                        )}
                        {walkUpEmail.trim() || walkUpContactId ? null : (
                          <p className="text-xs text-gray-300">
                            No email: they get a badge but no login, and their company&apos;s admin is told.
                          </p>
                        )}
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
                <button
                  type="button"
                  onClick={() =>
                    openSell({
                      organizationId: companyMatches.length === 1 ? companyMatches[0].organizationId : null,
                      companyHint: companyMatches.length === 1 ? null : nameLookup.trim(),
                    })
                  }
                  className="min-h-12 rounded-lg bg-white px-4 text-base font-semibold text-black"
                >
                  Not registered? Sell them a registration →
                </button>
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
                    <button
                      type="button"
                      onClick={() => sellForPerson(row.id)}
                      className="min-h-12 shrink-0 rounded-lg border border-white/50 px-4 text-sm font-semibold text-white"
                    >
                      Sell
                    </button>
                    {/* ⛔ Already in: Find is the only way back to them when the
                        badge is LOST (nothing to scan), so it opens the same
                        reprint card a second scan would. */}
                    {row.checked_in_at ? (
                      <button
                        type="button"
                        onClick={() => {
                          setLookupOpen(false);
                          setNameLookup("");
                          pushScanCard("already_checked_in", row.id);
                        }}
                        className="min-h-12 shrink-0 rounded-lg bg-white px-4 text-sm font-semibold text-black"
                      >
                        Reprint
                      </button>
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
      {pendingScans.length > 0 ? (
        <div className="absolute bottom-6 left-6 flex flex-col gap-2">
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

      {sellContext ? (
        <DeskSellPanel
          conferenceId={conferenceId}
          storefrontPath={storefrontPath}
          context={sellContext}
          onClose={() => setSellContext(null)}
          onSold={(people, state) => {
            setSellContext(null);
            // Unknown people make the desk refetch roster and facts — see pushScanCard.
            for (const person of people) {
              pushScanCard(state === "paid" ? "sale_paid" : "sale_invoiced", person.personId);
            }
          }}
        />
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
              icon={<SellIcon />}
              label="Sell"
              onClick={() => openSell({ doorEventId: doorEntityRef.current })}
            />
            {doorEvents.length > 0 ? (
              <ToolButton
                size="lg"
                showLabel
                icon={<CalendarIcon />}
                label="Change which event you're checking in"
                onClick={() => {
                  setDeskMenuOpen(false);
                  setDoorPicker("manual");
                }}
              />
            ) : null}
            <ToolButton
              size="lg"
              showLabel
              icon={<PrintIcon />}
              label="Open the print station (laptop by the printer)"
              onClick={() => {
                setDeskMenuOpen(false);
                window.open(`/admin/conference/${conferenceId}/check-in/print-station`, "_blank", "noopener");
              }}
            />
            {activeDoorEvent ? (
              <ToolButton
                size="lg"
                showLabel
                icon={<PrintIcon />}
                label={`Print list: ${activeDoorEvent.name}`}
                onClick={() => {
                  setDeskMenuOpen(false);
                  window.open(
                    `/admin/conference/${conferenceId}/check-in/door-list?entity=${activeDoorEvent.id}`,
                    "_blank",
                    "noopener"
                  );
                }}
              />
            ) : null}
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

function SellIcon() {
  return (
    <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.6 3H5a2 2 0 0 0-2 2v4.6a2 2 0 0 0 .6 1.4l9.4 9.4a2 2 0 0 0 2.8 0l4.6-4.6a2 2 0 0 0 0-2.8L11 3.6A2 2 0 0 0 9.6 3Z"
      />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.83c-.24.03-.48.06-.72.1m.72-.1a42.4 42.4 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.17c.24.03.48.06.72.1m-.72-.1L17.66 18m0 0 .23 2.5a1.13 1.13 0 0 1-1.12 1.24H7.23a1.13 1.13 0 0 1-1.12-1.24L6.34 18m11.32 0h1.09A2.25 2.25 0 0 0 21 15.75V9.46c0-1.08-.77-2.01-1.84-2.18a48.4 48.4 0 0 0-1.66-.22M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.46c0-1.08.77-2.01 1.84-2.18.55-.08 1.1-.16 1.66-.22m11 0a48.6 48.6 0 0 0-11 0m11 0V3.38c0-.62-.5-1.13-1.13-1.13H7.63c-.62 0-1.13.5-1.13 1.13v3.68" />
    </svg>
  );
}

/** "17:30" → "5:30 pm". */
function wallTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * Which event is this device checking in to? Asked after the PIN when an
 * event's window is open; reopened from the toolkit, where every event is
 * listed (reconciling afterwards, or an uncapped one like an AGM).
 */
function DoorPicker({
  events,
  openNow,
  showAll,
  activeId,
  onPick,
  onClose,
}: {
  events: DoorEvent[];
  openNow: DoorEvent[];
  showAll: boolean;
  activeId: string | null;
  onPick: (event: DoorEvent | null) => void;
  onClose: (() => void) | null;
}) {
  const others = showAll ? events.filter((event) => !openNow.some((open) => open.id === event.id)) : [];
  const row = (event: DoorEvent) => (
    <button
      key={event.id}
      type="button"
      onClick={() => onPick(event)}
      className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl px-5 py-3 text-left text-base font-semibold ${
        event.id === activeId ? "bg-emerald-400 text-black" : "bg-white text-black"
      }`}
    >
      <span>{event.name}</span>
      <span className="shrink-0 text-sm font-normal text-gray-600">
        {shortDay(event.date)} · {wallTime(event.startTime)} to {wallTime(event.endTime)}
      </span>
    </button>
  );
  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center overflow-y-auto bg-gray-950 px-5 py-10 text-white">
      <div className="w-full max-w-lg space-y-4">
        <p className="text-2xl font-bold">
          {openNow.length > 0 ? "Is this check-in for an event?" : "Which event are you checking in?"}
        </p>
        {openNow.length > 0 ? <div className="space-y-2">{openNow.map(row)}</div> : null}
        <button
          type="button"
          onClick={() => onPick(null)}
          className={`min-h-14 w-full rounded-xl border px-5 text-base font-semibold ${
            activeId === null ? "border-emerald-400 text-emerald-300" : "border-white/40 text-white"
          }`}
        >
          No, badge pickup
        </button>
        {others.length > 0 ? (
          <div className="space-y-2 pt-4">
            <p className="text-sm uppercase tracking-wider text-gray-400">Other events</p>
            {others.map(row)}
          </div>
        ) : null}
        {onClose ? (
          <button type="button" onClick={onClose} className="min-h-12 w-full rounded-lg px-5 text-base text-gray-300 underline">
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
