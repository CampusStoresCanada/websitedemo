"use client";

/**
 * Shipping boxes home: the one form, used by the shipping desk (for anyone,
 * full screen) and by the attendee on /me (for themselves, as a card). Where
 * the boxes go (prefilled from their institution), the boxes, Purolator's
 * prices, who pays, book, and what happens next.
 *
 * The two callers differ only in their frame and one control: the desk asks
 * the staff PIN before CSC pays (`approveCscPayer`), as it does for an
 * invoice. Design: docs/purolator/SHIPPING_STATION_DESIGN.md.
 */

import { useState, type ReactNode } from "react";
import { formatCents } from "@/lib/utils";
import {
  bookConferenceShipment,
  quoteConferenceShipment,
  voidConferenceShipment,
} from "@/lib/actions/conference-shipping";
import type { DeskShipment, Shipper, ShippingDestination } from "@/lib/conference/shipping";
import type { PurolatorBox, PurolatorQuote } from "@/lib/purolator/types";
import { serviceName } from "@/lib/purolator/services";

const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

// ⛔ One box: CSC standardizes them, every one 12 × 12 × 24 in (Steve,
// 2026-11-04). The desk weighs it; nobody measures anything.
const STANDARD_BOX = { lengthIn: 24, widthIn: 12, heightIn: 12 };

type BoxDraft = { weight: string };

const newBox = (): BoxDraft => ({ weight: "" });

function toBoxes(drafts: BoxDraft[]): PurolatorBox[] {
  return drafts.map((b) => ({ weightLb: Number(b.weight), ...STANDARD_BOX }));
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
  | { step: "done"; shipmentId: string; reference: string; labelsQueued: boolean };

/**
 * Mount with `key={shipper.personId}` so a new person starts a fresh form.
 */
export default function ShipmentForm({
  conferenceId,
  shipper,
  canQuote,
  approveCscPayer,
  labelsHref,
  labelsNote,
  finishLabel,
  onBooked,
  onFinish,
}: {
  conferenceId: string;
  shipper: Shipper;
  /** False when the conference has no ship-from address yet. */
  canQuote: boolean;
  /** The desk's staff PIN before CSC pays. Absent on /me: the attendee confirms by booking. */
  approveCscPayer?: (p: { subtitle: string; onPassed: () => void; onCancel: () => void }) => ReactNode;
  /** Where the label PDF opens. Absent on /me: labels print at the desk. */
  labelsHref?: (shipmentId: string) => string;
  /** What happens to the labels now, after booking. */
  labelsNote: (boxes: number) => string;
  finishLabel: string;
  onBooked?: () => void;
  onFinish: () => void;
}) {
  const [destination, setDestination] = useState<ShippingDestination>(shipper.destination);
  const [boxes, setBoxes] = useState<BoxDraft[]>([newBox()]);
  const [quotes, setQuotes] = useState<PurolatorQuote[] | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [payer, setPayer] = useState<"csc" | "institution">(shipper.institutionAccount ? "institution" : "csc");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ step: "form" });

  // Any change to where or what invalidates the prices shown.
  const forgetPrices = () => {
    setQuotes(null);
    setServiceId(null);
  };
  const editDestination = (patch: Partial<ShippingDestination>) => {
    setDestination((d) => ({ ...d, ...patch }));
    forgetPrices();
  };
  const editBox = (i: number, patch: Partial<BoxDraft>) => {
    setBoxes((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
    forgetPrices();
  };

  const getPrices = async () => {
    setBusy(true);
    setError(null);
    const res = await quoteConferenceShipment({
      conferenceId,
      personId: shipper.personId,
      destination,
      boxes: toBoxes(boxes),
    });
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
    if (!serviceId) return;
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
    onBooked?.();
  };

  if (stage.step === "approve" && approveCscPayer) {
    return (
      <>
        {approveCscPayer({
          subtitle: `Staff PIN: CSC pays Purolator and invoices ${shipper.organizationName ?? "their institution"}${
            chosen ? `, about ${formatCents(chosen.totalCents)}` : ""
          }.`,
          onPassed: () => void book(),
          onCancel: () => setStage({ step: "form" }),
        })}
      </>
    );
  }

  if (stage.step === "done") {
    return (
      <div>
        <p className="text-xl font-semibold">{shipper.name}</p>
        <p className="text-base text-gray-600">
          {serviceName(serviceId ?? "")} to {destination.city}, {destination.province}
        </p>
        <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Reference</p>
        <p className="text-2xl font-bold tracking-wide">{stage.reference}</p>
        {stage.labelsQueued ? (
          <p className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-base text-emerald-900">{labelsNote(boxes.length)}</p>
        ) : (
          <p className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-base text-amber-900">
            The labels didn&apos;t reach the print queue.{" "}
            {labelsHref ? "Open them below and print them another way." : "Ask at the shipping desk."}
          </p>
        )}
        {labelsHref ? (
          <>
            <a
              href={labelsHref(stage.shipmentId)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex min-h-14 items-center justify-center rounded-xl border border-gray-300 px-6 text-lg font-semibold"
            >
              Open the labels ({boxes.length} page{boxes.length === 1 ? "" : "s"})
            </a>
            <p className="mt-2 text-sm text-gray-600">One 4×6 label per box. Stick each on its own box.</p>
          </>
        ) : null}
        <button
          type="button"
          onClick={onFinish}
          className="mt-6 min-h-14 w-full rounded-xl border border-gray-300 text-lg font-semibold"
        >
          {finishLabel}
        </button>
      </div>
    );
  }

  return (
    <div>
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
                      forgetPrices();
                    }}
                    className="min-h-10 px-3 text-sm text-red-700"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="mt-2 grid grid-cols-2 items-end gap-3">
                <Field label="Weight (lb)" inputMode="decimal" value={b.weight} onChange={(v) => editBox(i, { weight: v })} />
                <p className="pb-3 text-sm text-gray-600">Standard box, 12 × 12 × 24 in</p>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setBoxes((bs) => [...bs, newBox()]);
              forgetPrices();
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
          disabled={busy || !canQuote}
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
            onClick={() => (payer === "csc" && approveCscPayer ? setStage({ step: "approve" }) : void book())}
            className="min-h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white disabled:opacity-60"
          >
            {stage.step === "booking" ? "Booking with Purolator…" : `Book ${serviceName(serviceId ?? "")}`}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Shipments with their tracking numbers, and Cancel (and Labels, at the desk).
 * Without `onChanged` the list only shows: an org admin sees their
 * institution's shipments but cancels nothing they did not book.
 */
export function ShipmentList({
  conferenceId,
  shipments,
  showPerson,
  labelsHref,
  onChanged,
}: {
  conferenceId: string;
  shipments: DeskShipment[];
  showPerson: boolean;
  labelsHref?: (shipmentId: string) => string;
  onChanged?: () => Promise<void>;
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
    await onChanged?.();
  };

  return (
    <div>
      {error ? <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">{error}</div> : null}
      {shipments.length === 0 ? <p className="text-base text-gray-600">Nothing booked yet.</p> : null}
      <ul className="space-y-3">
        {shipments.map((s) => {
          const voided = s.status === "voided";
          return (
            <li key={s.id} className={`rounded-xl border border-gray-200 bg-white p-4 ${voided ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {showPerson ? <p className="text-base font-semibold">{s.personName ?? "Unknown"}</p> : null}
                  <p className="text-sm text-gray-600">
                    {showPerson && s.organizationName ? `${s.organizationName} · ` : ""}
                    {serviceName(s.serviceId)} to {s.destination}
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
              {!voided && (labelsHref || onChanged) ? (
                <div className="mt-3 flex gap-2">
                  {labelsHref ? (
                    <a
                      href={labelsHref(s.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-12 flex-1 items-center justify-center rounded-lg border border-gray-300 text-base font-medium"
                    >
                      Labels
                    </a>
                  ) : null}
                  {!onChanged ? null : confirming === s.id ? (
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
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
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
        className="mt-1 min-h-12 w-full rounded-lg border border-gray-300 bg-white px-3 text-base"
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
