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
import { formatCents } from "@/lib/utils";
import { getDeskPinState } from "@/lib/actions/desk-pin";
import { DeskPinCheck, DeskPinSetup } from "@/components/admin/conference/DeskPinPad";
import {
  bookConferenceShipment,
  listConferenceShipments,
  loadShippingPerson,
  quoteConferenceShipment,
  voidConferenceShipment,
} from "@/lib/actions/conference-shipping";
import type { DeskShipment, Shipper, ShippingDestination, ShippingRosterRow } from "@/lib/conference/shipping";
import type { PurolatorBox, PurolatorQuote } from "@/lib/purolator/types";
import { serviceName } from "@/lib/purolator/services";

const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

// Sizes the desk keeps on hand. "Custom" takes any size.
const BOX_PRESETS = [
  { key: "small", label: "Small 12×12×8", l: 12, w: 12, h: 8 },
  { key: "medium", label: "Medium 18×14×12", l: 18, w: 14, h: 12 },
  { key: "large", label: "Large 24×18×18", l: 24, w: 18, h: 18 },
] as const;

type BoxDraft = { preset: string; weight: string; l: string; w: string; h: string };

const newBox = (): BoxDraft => ({ preset: "medium", weight: "", l: "18", w: "14", h: "12" });

function toBoxes(drafts: BoxDraft[]): PurolatorBox[] {
  return drafts.map((b) => ({
    weightLb: Number(b.weight),
    lengthIn: Number(b.l),
    widthIn: Number(b.w),
    heightIn: Number(b.h),
  }));
}

function arrives(q: PurolatorQuote): string {
  if (q.expectedDeliveryDate) {
    const d = new Date(`${q.expectedDeliveryDate}T12:00:00`);
    return `arrives ${d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}`;
  }
  return q.transitDays ? `${q.transitDays} business day${q.transitDays === 1 ? "" : "s"}` : "";
}

type Stage =
  | { step: "form" }
  | { step: "approve" }
  | { step: "booking" }
  | { step: "done"; shipmentId: string; reference: string };

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

  // ── The shipment being built
  const [destination, setDestination] = useState<ShippingDestination | null>(null);
  const [boxes, setBoxes] = useState<BoxDraft[]>([newBox()]);
  const [quotes, setQuotes] = useState<PurolatorQuote[] | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [payer, setPayer] = useState<"csc" | "institution">("csc");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ step: "form" });

  const startWith = useCallback((s: Shipper) => {
    setShipper(s);
    setDestination(s.destination);
    setBoxes([newBox()]);
    setQuotes(null);
    setServiceId(null);
    setPayer(s.institutionAccount ? "institution" : "csc");
    setError(null);
    setStage({ step: "form" });
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

  const finish = () => {
    setShipper(null);
    setDestination(null);
    setStage({ step: "form" });
  };

  // Any change to where or what invalidates the prices shown.
  const editDestination = (patch: Partial<ShippingDestination>) => {
    setDestination((d) => (d ? { ...d, ...patch } : d));
    setQuotes(null);
    setServiceId(null);
  };
  const editBox = (i: number, patch: Partial<BoxDraft>) => {
    setBoxes((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
    setQuotes(null);
    setServiceId(null);
  };

  const getPrices = async () => {
    if (!destination) return;
    setBusy(true);
    setError(null);
    const res = await quoteConferenceShipment({ conferenceId, destination, boxes: toBoxes(boxes) });
    setBusy(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setQuotes(res.data);
    setServiceId(res.data.find((q) => q.serviceId === "PurolatorGround")?.serviceId ?? res.data[0].serviceId);
  };

  const chosen = quotes?.find((q) => q.serviceId === serviceId) ?? null;

  const book = async () => {
    if (!shipper || !destination || !serviceId) return;
    setStage({ step: "booking" });
    setError(null);
    const res = await bookConferenceShipment({
      conferenceId,
      personId: shipper.personId,
      destination,
      boxes: toBoxes(boxes),
      serviceId,
      payer,
      shownQuote: chosen,
    });
    if (!res.success) {
      setError(res.error);
      setStage({ step: "form" });
      return;
    }
    setStage({ step: "done", ...res.data });
    void refreshShipments();
  };

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
        <ShipmentList
          conferenceId={conferenceId}
          shipments={shipments}
          onClose={() => setListOpen(false)}
          onChanged={refreshShipments}
        />
      ) : null}

      {shipper && destination && stage.step === "approve" ? (
        <DeskPinCheck
          conferenceId={conferenceId}
          title="Approve the shipment"
          subtitle={`Staff PIN: CSC pays Purolator and invoices ${shipper.organizationName ?? "their institution"}${
            chosen ? `, about ${formatCents(chosen.totalCents)}` : ""
          }.`}
          onCancel={() => setStage({ step: "form" })}
          onPassed={() => void book()}
        />
      ) : null}

      {shipper && destination && stage.step === "done" ? (
        <Sheet title="Booked" onClose={finish}>
          <p className="text-xl font-semibold">{shipper.name}</p>
          <p className="text-base text-gray-600">
            {serviceName(serviceId ?? "")} to {destination.city}, {destination.province}
          </p>
          <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Reference</p>
          <p className="text-2xl font-bold tracking-wide">{stage.reference}</p>
          <a
            href={`/api/admin/conference/${conferenceId}/shipping/${stage.shipmentId}/labels`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 flex min-h-14 items-center justify-center rounded-xl bg-accent px-6 text-lg font-semibold text-white"
          >
            Open the labels ({boxes.length} page{boxes.length === 1 ? "" : "s"})
          </a>
          <p className="mt-2 text-sm text-gray-600">One 4×6 label per box. Stick each on its own box.</p>
          <button
            type="button"
            onClick={finish}
            className="mt-6 min-h-14 w-full rounded-xl border border-gray-300 text-lg font-semibold"
          >
            Next person
          </button>
        </Sheet>
      ) : null}

      {shipper && destination && (stage.step === "form" || stage.step === "booking") ? (
        <Sheet title={`Ship for ${shipper.name}`} onClose={finish}>
          <p className="-mt-2 mb-4 text-base text-gray-600">{shipper.organizationName ?? "No institution on file"}</p>

          <Section title="Ship to">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Institution" className="col-span-2" value={destination.company} onChange={(v) => editDestination({ company: v })} />
              <Field label="Attention" className="col-span-2" value={destination.attention} onChange={(v) => editDestination({ attention: v })} />
              <Field label="Street" className="col-span-2" value={destination.street} onChange={(v) => editDestination({ street: v })} />
              <Field label="Suite, building (optional)" className="col-span-2" value={destination.street2} onChange={(v) => editDestination({ street2: v })} />
              <Field label="City" value={destination.city} onChange={(v) => editDestination({ city: v })} />
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Province</span>
                <select
                  value={destination.province}
                  onChange={(e) => editDestination({ province: e.target.value })}
                  className="mt-1 min-h-12 w-full rounded-lg border border-gray-300 px-3 text-base"
                >
                  <option value="">Pick…</option>
                  {PROVINCES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <Field label="Postal code" value={destination.postalCode} onChange={(v) => editDestination({ postalCode: v })} />
              <Field label="Phone" value={destination.phone} onChange={(v) => editDestination({ phone: v })} />
            </div>
          </Section>

          <Section title="Boxes">
            <div className="space-y-3">
              {boxes.map((b, i) => (
                <div key={i} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold">Box {i + 1}</span>
                    {boxes.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setBoxes((bs) => bs.filter((_, j) => j !== i));
                          setQuotes(null);
                          setServiceId(null);
                        }}
                        className="min-h-10 px-3 text-sm text-red-700"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <Field label="Weight (lb)" inputMode="decimal" value={b.weight} onChange={(v) => editBox(i, { weight: v })} />
                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">Size</span>
                      <select
                        value={b.preset}
                        onChange={(e) => {
                          const p = BOX_PRESETS.find((x) => x.key === e.target.value);
                          editBox(i, p ? { preset: p.key, l: String(p.l), w: String(p.w), h: String(p.h) } : { preset: "custom" });
                        }}
                        className="mt-1 min-h-12 w-full rounded-lg border border-gray-300 px-3 text-base"
                      >
                        {BOX_PRESETS.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                        <option value="custom">Custom size</option>
                      </select>
                    </label>
                    {b.preset === "custom" ? (
                      <div className="col-span-2 grid grid-cols-3 gap-3">
                        <Field label="Length (in)" inputMode="decimal" value={b.l} onChange={(v) => editBox(i, { l: v })} />
                        <Field label="Width (in)" inputMode="decimal" value={b.w} onChange={(v) => editBox(i, { w: v })} />
                        <Field label="Height (in)" inputMode="decimal" value={b.h} onChange={(v) => editBox(i, { h: v })} />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  setBoxes((bs) => [...bs, newBox()]);
                  setQuotes(null);
                  setServiceId(null);
                }}
                className="min-h-12 w-full rounded-xl border border-dashed border-gray-400 text-base font-medium text-gray-700"
              >
                Add another box
              </button>
            </div>
          </Section>

          {error ? <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">{error}</div> : null}

          {!quotes ? (
            <button
              type="button"
              disabled={busy || !originLabel}
              onClick={() => void getPrices()}
              className="min-h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Asking Purolator…" : "Get prices"}
            </button>
          ) : (
            <>
              <Section title="Service">
                <div className="space-y-2">
                  {quotes.map((q) => (
                    <button
                      type="button"
                      key={q.serviceId}
                      onClick={() => setServiceId(q.serviceId)}
                      className={`flex min-h-14 w-full items-center justify-between rounded-xl border px-4 text-left ${
                        q.serviceId === serviceId ? "border-accent bg-accent/10 ring-2 ring-accent" : "border-gray-200"
                      }`}
                    >
                      <span>
                        <span className="block text-base font-semibold">{serviceName(q.serviceId)}</span>
                        <span className="block text-sm text-gray-600">{arrives(q)}</span>
                      </span>
                      <span className="text-base font-semibold">about {formatCents(q.totalCents)}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  These are Purolator&apos;s estimates, tax included. The institution is billed what Purolator actually charges.
                </p>
              </Section>

              <Section title="Who pays">
                {shipper.institutionAccount ? (
                  <div className="space-y-2">
                    <PayerOption
                      checked={payer === "institution"}
                      onSelect={() => setPayer("institution")}
                      title={`${shipper.organizationName}'s own Purolator account`}
                      detail={`Account ending ${shipper.institutionAccount.slice(-4)}. Purolator bills them directly; CSC invoices nothing.`}
                    />
                    <PayerOption
                      checked={payer === "csc"}
                      onSelect={() => setPayer("csc")}
                      title="CSC pays, then invoices them"
                      detail="CSC invoices the institution Purolator's actual charge after the conference."
                    />
                  </div>
                ) : (
                  <p className="text-base text-gray-700">
                    CSC pays Purolator and invoices {shipper.organizationName ?? "their institution"} the actual charge after the
                    conference.
                  </p>
                )}
              </Section>

              <button
                type="button"
                disabled={!serviceId || stage.step === "booking"}
                onClick={() => (payer === "csc" ? setStage({ step: "approve" }) : void book())}
                className="min-h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white disabled:opacity-60"
              >
                {stage.step === "booking" ? "Booking with Purolator…" : `Book ${serviceName(serviceId ?? "")}`}
              </button>
            </>
          )}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
  inputMode?: "decimal" | "text";
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-12 w-full rounded-lg border border-gray-300 px-3 text-base"
      />
    </label>
  );
}

function PayerOption({
  checked,
  onSelect,
  title,
  detail,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border px-4 py-3 text-left ${checked ? "border-accent bg-accent/10 ring-2 ring-accent" : "border-gray-200"}`}
    >
      <span className="block text-base font-semibold">{title}</span>
      <span className="block text-sm text-gray-600">{detail}</span>
    </button>
  );
}

function ShipmentList({
  conferenceId,
  shipments,
  onClose,
  onChanged,
}: {
  conferenceId: string;
  shipments: DeskShipment[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancel = async (id: string) => {
    setBusy(id);
    setError(null);
    const res = await voidConferenceShipment({ conferenceId, shipmentId: id });
    setBusy(null);
    setConfirming(null);
    if (!res.success) setError(res.error);
    await onChanged();
  };

  return (
    <Sheet title="Shipments" onClose={onClose}>
      {error ? <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">{error}</div> : null}
      {shipments.length === 0 ? <p className="text-base text-gray-600">Nothing booked yet.</p> : null}
      <ul className="space-y-3">
        {shipments.map((s) => {
          const voided = s.status === "voided";
          return (
            <li key={s.id} className={`rounded-xl border border-gray-200 p-4 ${voided ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold">{s.personName ?? "Unknown"}</p>
                  <p className="text-sm text-gray-600">
                    {s.organizationName ?? ""} · {serviceName(s.serviceId)} to {s.destination}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {s.reference} · {s.packagePins.length} box{s.packagePins.length === 1 ? "" : "es"} ·{" "}
                    {s.billingMode === "institution_account" ? "their account" : "CSC invoices"}
                    {s.estimateCents != null ? ` · est. ${formatCents(s.estimateCents)}` : ""}
                    {s.environment === "sandbox" ? " · sandbox" : ""}
                  </p>
                  <p className="mt-1 break-all text-xs text-gray-500">Tracking {s.packagePins.join(", ")}</p>
                </div>
                <span className="shrink-0 text-sm font-semibold">{voided ? "Cancelled" : "Booked"}</span>
              </div>
              {!voided ? (
                <div className="mt-3 flex gap-2">
                  <a
                    href={`/api/admin/conference/${conferenceId}/shipping/${s.id}/labels`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-12 flex-1 items-center justify-center rounded-lg border border-gray-300 text-base font-medium"
                  >
                    Labels
                  </a>
                  {confirming === s.id ? (
                    <button
                      type="button"
                      disabled={busy === s.id}
                      onClick={() => void cancel(s.id)}
                      className="min-h-12 flex-1 rounded-lg bg-red-600 text-base font-semibold text-white disabled:opacity-60"
                    >
                      {busy === s.id ? "Cancelling…" : "Yes, cancel it"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(s.id)}
                      className="min-h-12 flex-1 rounded-lg border border-red-300 text-base font-medium text-red-700"
                    >
                      Cancel shipment
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
