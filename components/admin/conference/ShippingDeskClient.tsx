"use client";

/**
 * The conference shipping desk: a full-screen kiosk beside the check-in desk,
 * built the same way. Scan a badge (or find them by name), confirm where the
 * boxes go, weigh them, pick a Purolator service, book, open the labels.
 *
 * ⛔ Scanning a badge here never checks anyone in: it only says who is
 * shipping (personForBadge, not the check-in scan).
 *
 * Design: docs/purolator/SHIPPING_STATION_DESIGN.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDeskPinState } from "@/lib/actions/desk-pin";
import { DeskPinCheck, DeskPinSetup } from "@/components/admin/conference/DeskPinPad";
import { listConferenceShipments, loadShippingPerson } from "@/lib/actions/conference-shipping";
import type { DeskShipment, Shipper, ShippingRosterRow } from "@/lib/conference/shipping";
import ShipmentForm, { ShipmentList } from "@/components/conference/ShipmentForm";

export default function ShippingDeskClient({
  conferenceId,
  roster,
  initialShipments,
  originLabel,
  sandbox,
}: {
  conferenceId: string;
  roster: ShippingRosterRow[];
  initialShipments: DeskShipment[];
  originLabel: string | null;
  sandbox: boolean;
}) {
  // ── The desk PIN, as on the check-in desk: set one before anything else.
  const [pinState, setPinState] = useState<{ hasPin: boolean; mayChoose: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    void getDeskPinState(conferenceId).then((res) => {
      if (!live) return;
      setPinState(
        res.success ? { hasPin: res.data.hasPin, mayChoose: res.data.mayResetWithoutPin } : { hasPin: true, mayChoose: false }
      );
    });
    return () => {
      live = false;
    };
  }, [conferenceId]);

  useEffect(() => {
    document.body.classList.add("check-in-kiosk");
    return () => document.body.classList.remove("check-in-kiosk");
  }, []);

  const [shipments, setShipments] = useState(initialShipments);
  const refreshShipments = useCallback(async () => {
    const res = await listConferenceShipments(conferenceId);
    if (res.success) setShipments(res.data);
  }, [conferenceId]);

  // ── Who is shipping
  const [shipper, setShipper] = useState<Shipper | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [query, setQuery] = useState("");

  const startWith = useCallback((s: Shipper) => {
    setShipper(s);
    setFindOpen(false);
    setQuery("");
    setLookupError(null);
  }, []);

  const pick = useCallback(
    async (args: { personId?: string; scanned?: string }) => {
      const res = await loadShippingPerson({ conferenceId, ...args });
      if (res.success) startWith(res.data);
      else setLookupError(res.error);
    },
    [conferenceId, startWith]
  );

  const labelsHref = (shipmentId: string) => `/api/admin/conference/${conferenceId}/shipping/${shipmentId}/labels`;

  // ── Camera: the check-in desk's scanner, idle while a panel is open.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const panelOpen = Boolean(shipper) || findOpen || listOpen || !pinState?.hasPin;
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    let last: { value: string; at: number } | null = null;
    void (async () => {
      try {
        const zxing = await import("@zxing/browser");
        const reader = new zxing.BrowserMultiFormatReader();
        if (stopped || !videoRef.current) return;
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (!result || panelOpenRef.current) return;
          const raw = result.getText?.().trim();
          if (!raw) return;
          const now = Date.now();
          if (last && last.value === raw && now - last.at < 3000) return;
          last = { value: raw, at: now };
          void pickRef.current({ scanned: raw });
        });
        if (stopped) controls.stop();
      } catch (e) {
        setCameraError(e instanceof Error ? e.message : "The camera could not start.");
      }
    })();
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return roster
      .filter((r) => `${r.name} ${r.email ?? ""} ${r.organizationName ?? ""}`.toLowerCase().includes(q))
      .slice(0, 25);
  }, [query, roster]);

  const liveShipments = shipments.filter((s) => s.status !== "voided");

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden bg-black text-white">
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
      ) : null}

      <video
        ref={videoRef}
        className={`h-full w-full object-cover transition-[filter] duration-200 ${panelOpen ? "blur-md brightness-50" : ""}`}
        muted
        autoPlay
        playsInline
      />

      {/* ⛔ As unmissable as the check-in desk's test mode: nothing booked in
          Purolator's sandbox ships or is billed. */}
      {sandbox ? (
        <div className="absolute inset-x-0 top-0 z-20 bg-amber-500 px-3 py-2 text-center text-sm font-bold text-black">
          PUROLATOR SANDBOX: bookings are rehearsals. Nothing ships and nothing is billed.
        </div>
      ) : null}

      <div className={`absolute inset-x-0 ${sandbox ? "top-10" : "top-0"} z-10 flex items-center justify-between gap-3 p-4`}>
        <div className="rounded-full bg-black/60 px-4 py-2 text-base font-semibold">Shipping desk</div>
        <button
          type="button"
          onClick={() => setListOpen(true)}
          className="min-h-12 rounded-full bg-white px-5 text-base font-semibold text-black shadow-lg"
        >
          Shipments{liveShipments.length ? ` (${liveShipments.length})` : ""}
        </button>
      </div>

      {!panelOpen ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-64 w-64 rounded-3xl border-4 border-white/70" />
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 p-6">
        {lookupError ? (
          <div className="max-w-md rounded-xl bg-amber-100 px-4 py-3 text-center text-base text-amber-900">{lookupError}</div>
        ) : null}
        {cameraError ? (
          <div className="max-w-md rounded-xl bg-white/90 px-4 py-3 text-center text-sm text-gray-800">
            No camera ({cameraError}). Find them by name.
          </div>
        ) : null}
        {!originLabel ? (
          <div className="max-w-md rounded-xl bg-red-100 px-4 py-3 text-center text-sm text-red-800">
            This conference has no ship-from address, so nothing can be priced or booked.
          </div>
        ) : null}
        <p className="text-lg font-semibold drop-shadow">Scan their badge to ship their boxes</p>
        <button
          type="button"
          onClick={() => {
            setFindOpen(true);
            setLookupError(null);
          }}
          className="min-h-14 rounded-full bg-white px-8 text-lg font-semibold text-black shadow-lg"
        >
          Find by name
        </button>
      </div>

      {findOpen ? (
        <Sheet title="Find who is shipping" onClose={() => setFindOpen(false)}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, email or institution"
            className="min-h-14 w-full rounded-xl border border-gray-300 px-4 text-lg"
          />
          <ul className="mt-3 divide-y divide-gray-100">
            {matches.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void pick({ personId: r.id })}
                  className="flex min-h-14 w-full flex-col items-start justify-center py-2 text-left"
                >
                  <span className="text-lg font-semibold">{r.name}</span>
                  <span className="text-sm text-gray-600">{r.organizationName ?? r.email ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
          {query.trim().length >= 2 && matches.length === 0 ? (
            <p className="mt-3 text-base text-gray-600">Nobody on the roster matches.</p>
          ) : null}
        </Sheet>
      ) : null}

      {listOpen ? (
        <Sheet title="Shipments" onClose={() => setListOpen(false)}>
          <ShipmentList
            conferenceId={conferenceId}
            shipments={shipments}
            showPerson
            labelsHref={labelsHref}
            onChanged={refreshShipments}
          />
        </Sheet>
      ) : null}

      {shipper ? (
        <Sheet title={`Ship for ${shipper.name}`} onClose={() => setShipper(null)}>
          <p className="-mt-2 mb-4 text-base text-gray-600">{shipper.organizationName ?? "No institution on file"}</p>
          <ShipmentForm
            key={shipper.personId}
            conferenceId={conferenceId}
            shipper={shipper}
            canQuote={Boolean(originLabel)}
            approveCscPayer={({ subtitle, onPassed, onCancel }) => (
              <DeskPinCheck
                conferenceId={conferenceId}
                title="Approve the shipment"
                subtitle={subtitle}
                onCancel={onCancel}
                onPassed={onPassed}
              />
            )}
            labelsHref={labelsHref}
            labelsNote={(n) =>
              `${n} label${n === 1 ? " is" : "s are"} waiting on the print queue. They print when the die-cut shipping roll is in and someone presses “Print the shipping labels” in the War Room.`
            }
            finishLabel="Next person"
            onBooked={() => void refreshShipments()}
            onFinish={() => setShipper(null)}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-white text-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
        <p className="truncate text-xl font-bold">{title}</p>
        <button type="button" onClick={onClose} className="min-h-12 shrink-0 rounded-lg border border-gray-300 px-5 text-base font-medium">
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
