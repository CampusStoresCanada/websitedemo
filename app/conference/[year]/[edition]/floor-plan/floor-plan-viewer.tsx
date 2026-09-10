"use client";

import { useRef, useState } from "react";
import { addOfferToCart } from "@/lib/actions/conference-commerce";
import { createProspectiveBoothCheckout } from "@/lib/actions/prospective-booth-checkout";
import { dispatchConferenceCartUpdated } from "@/lib/conference/cart-events";
import { formatCents } from "@/lib/utils";
import type { FloorPlanBooth } from "@/lib/actions/conference-entities";
import { PROVINCES } from "@/lib/constants/provinces";

const VIEW_W = 1000;

// Fill = availability, as a value ramp (light → dark = more taken).
const STATUS_FILL: Record<FloorPlanBooth["status"], string> = {
  available: "#EEF2F6",  // lightest — open
  reserved:  "#94A3B8",  // mid — in someone's cart
  sold:      "#33415A",  // darkest — sold
  draft:     "#F9FAFB",
};
const STATUS_FILL_HOVER: Record<FloorPlanBooth["status"], string> = {
  available: "#DCE6F0",
  reserved:  "#94A3B8",
  sold:      "#33415A",
  draft:     "#F9FAFB",
};
// Stroke = booth track, independent of availability. CSC brand colours.
const TYPE_STROKE = {
  exhibitor: "#163D6D", // CSC navy — plain exhibitor booth
  connected: "#EE2A2E", // CSC red — bundled with the Connected Exhibitor Staff Registration
};
// Below this zoom, a booth is too small on screen for a logo to read — show the number instead.
const LOGO_ZOOM_THRESHOLD = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function formatGateDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-CA", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
}

// ─── Booth tooltip card — anchored to booth position, no layout shift ─────────

type MembershipGate = { previewPriceCents: number | null; newExpiresAt: string | null };

// Anonymous / no-org visitor — booths are meant to be freely purchasable by a
// brand-new prospect. Pay first, then get routed into the partner application
// (same pipeline the admin-side approval flow already uses).
function ProspectBoothForm({
  booth,
  conferenceId,
  conferenceYear,
  conferenceEdition,
}: {
  booth: FloorPlanBooth;
  conferenceId: string;
  conferenceYear: string;
  conferenceEdition: string;
}) {
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [province, setProvince] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!companyName.trim() || !email.trim() || !province) {
      setError("Company name, email, and province are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const baseUrl = window.location.origin;
    const conferencePath = `/conference/${conferenceYear}/${conferenceEdition}`;
    const result = await createProspectiveBoothCheckout({
      conferenceId,
      boothEntityId: booth.id,
      companyName,
      email,
      province,
      successUrl: `${baseUrl}${conferencePath}/exhibit/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}${conferencePath}/floor-plan`,
    });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    window.location.href = result.data.checkoutUrl;
  };

  const inputClass = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]";

  return (
    <div className="space-y-1.5">
      <input
        placeholder="Company name"
        value={companyName}
        onChange={e => setCompanyName(e.target.value)}
        className={inputClass}
      />
      <input
        type="email"
        placeholder="Contact email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        className={inputClass}
      />
      <select
        value={province}
        onChange={e => setProvince(e.target.value)}
        className={`${inputClass} bg-white`}
      >
        <option value="">Province…</option>
        <option value="Out of Canada">Out of Canada</option>
        <optgroup label="Canadian Provinces &amp; Territories">
          {PROVINCES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </optgroup>
      </select>
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={submitting}
        className="w-full rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
      >
        {submitting ? "Starting checkout…" : "Reserve & pay"}
      </button>
      <p className="text-[10px] text-gray-500 leading-snug">
        New to CSC? This also starts your partnership application — the board still
        reviews it after payment.
      </p>
    </div>
  );
}

function BoothCard({
  booth,
  posLeft,
  posTop,
  conferenceId,
  conferenceYear,
  conferenceEdition,
  organizationId,
  myCartOfferIds,
  membershipGate,
  alreadyHasAnotherBooth,
  onClose,
}: {
  booth: FloorPlanBooth;
  posLeft: number;
  posTop: number;
  conferenceId: string;
  conferenceYear: string;
  conferenceEdition: string;
  organizationId: string | null;
  myCartOfferIds: Set<string>;
  membershipGate: MembershipGate | null;
  alreadyHasAnotherBooth: boolean;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inCart  = myCartOfferIds.has(booth.id);
  const isAvail = booth.status === "available";

  const addToCart = async () => {
    if (!organizationId || adding) return;
    setAdding(true);
    setError(null);
    const res = await addOfferToCart({
      conferenceId,
      organizationId,
      offerEntityId: booth.id,
      quantity: 1,
    });
    setAdding(false);
    if (res.success) {
      setDone(true);
      dispatchConferenceCartUpdated(organizationId);
    } else {
      setError(res.error ?? "Failed to add to cart.");
    }
  };

  const statusLabel: Record<FloorPlanBooth["status"], string> = {
    available: "Available",
    reserved:  "In a cart",
    sold:      "Sold",
    draft:     "Not for sale",
  };

  // Flip horizontally / vertically to stay within map bounds
  const flipX = posLeft > 65;
  const flipY = posTop > 65;

  return (
    <div
      data-booth-card="true"
      className="absolute z-10 w-52 rounded-xl bg-white shadow-xl border border-gray-200 text-sm"
      style={{
        left: `${posLeft}%`,
        top: `${posTop}%`,
        transform: `translate(${flipX ? "-100%" : "8px"}, ${flipY ? "calc(-100% - 8px)" : "8px"})`,
        pointerEvents: "auto",
      }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      <button
        onClick={onClose}
        className="absolute right-2 top-2 text-gray-400 hover:text-gray-600 text-lg leading-none w-6 h-6 flex items-center justify-center"
      >
        ×
      </button>

      <div className="px-3 pt-3 pb-2 border-b border-gray-100">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Booth</div>
        <div className="font-bold text-gray-900 text-base leading-tight mt-0.5 pr-6">
          {booth.number ? `#${booth.number}` : booth.name}
        </div>
      </div>

      {booth.status === "sold" && booth.soldOrg ? (
        // Sold — the question here is "who is there?", not price/track detail.
        // The profile link below is the natural next question ("who ARE they?"),
        // and /org/[slug] does its own viewer masking, so it's safe to offer
        // from this deliberately-public page.
        <div className="px-3 py-3 space-y-2.5">
        <div className="flex items-center gap-3">
          {booth.soldOrg.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={booth.soldOrg.logoUrl} alt=""
              className="w-10 h-10 rounded-lg object-contain bg-gray-50 border border-gray-100 flex-shrink-0" />
          ) : (
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
              booth.soldOrg.type === "Member" ? "bg-red-50" : "bg-blue-50"
            }`}>
              <span className={`text-sm font-bold ${
                booth.soldOrg.type === "Member" ? "text-red-400" : "text-blue-400"
              }`}>
                {booth.soldOrg.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <p className="font-bold text-gray-900 text-sm leading-tight truncate">{booth.soldOrg.name}</p>
            <p className="text-xs text-gray-500 truncate">{booth.soldOrg.category ?? "Exhibitor"}</p>
          </div>
        </div>
        {booth.soldOrg.slug && (
          <a
            href={`/org/${booth.soldOrg.slug}`}
            className="block w-full rounded-md bg-[#163D6D] px-3 py-1.5 text-center text-xs font-semibold text-white transition-colors hover:bg-[#0F2C4F]"
          >
            See full profile →
          </a>
        )}
        </div>
      ) : (
        <div className="px-3 py-2 space-y-1">
          {booth.priceCents != null && (
            <div className="flex justify-between">
              <span className="text-gray-500">Price</span>
              <span className="font-medium text-gray-900">{formatCents(booth.priceCents)}</span>
            </div>
          )}
          {booth.size && (
            <div className="flex justify-between">
              <span className="text-gray-500">Size</span>
              <span className="font-medium text-gray-900">{booth.size}</span>
            </div>
          )}
          {booth.typeName && (
            <div className="flex justify-between">
              <span className="text-gray-500">Track</span>
              <span className="font-medium" style={{ color: booth.color != null ? TYPE_STROKE.connected : TYPE_STROKE.exhibitor }}>
                {booth.color != null ? "Connected Sponsor" : "Exhibitor"}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500">Status</span>
            <span className={`font-medium ${
              booth.status === "available" ? "text-[#163D6D]"
              : booth.status === "reserved" ? "text-[#EE2A2E]"
              : "text-gray-500"
            }`}>{statusLabel[booth.status]}</span>
          </div>
          {booth.heldByOrg && (
            <div className="flex justify-between gap-2">
              <span className="text-gray-500 shrink-0">Reserved by</span>
              <span className="font-medium text-gray-900 text-right truncate">{booth.heldByOrg}</span>
            </div>
          )}
        </div>
      )}

      {booth.pitch && booth.status !== "sold" && (
        <p className="px-3 pb-2 -mt-1 text-[11px] text-gray-600 leading-snug">
          {booth.pitch}
        </p>
      )}

      {isAvail && !inCart && !done && membershipGate && (
        <p className="px-3 pb-1 text-[11px] text-amber-700">
          Also renews your membership through {formatGateDate(membershipGate.newExpiresAt)}
          {membershipGate.previewPriceCents != null ? ` — ${formatCents(membershipGate.previewPriceCents)}` : ""}.
        </p>
      )}

      {isAvail && !inCart && !done && alreadyHasAnotherBooth && (
        <p className="px-3 pb-1 text-[11px] text-blue-700">
          You already hold a booth. A second one adds floor space, not meeting time —
          your meeting slots come from your registration, not booth count.
        </p>
      )}

      {error && <p className="px-3 pb-1 text-xs text-red-600">{error}</p>}

      {(isAvail || inCart) && (
        <div className="px-3 pb-3">
          {done ? (
            <p className="text-center text-xs font-medium text-[#163D6D] py-1.5">
              ✓ Added{membershipGate ? " — booth & membership renewal" : ""} — see cart to checkout
            </p>
          ) : inCart ? (
            <p className="text-center text-xs text-[#EE2A2E] py-1.5">
              Already in your cart
            </p>
          ) : organizationId ? (
            <button
              onClick={addToCart}
              disabled={adding}
              className="w-full rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add to cart"}
            </button>
          ) : (
            <ProspectBoothForm
              booth={booth}
              conferenceId={conferenceId}
              conferenceYear={conferenceYear}
              conferenceEdition={conferenceEdition}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main viewer ──────────────────────────────────────────────────────────────

export default function FloorPlanViewer({
  conferenceId,
  conferenceYear,
  conferenceEdition,
  organizationId,
  floorPlanUrl,
  booths,
  myCartOfferIds = new Set(),
  membershipGate = null,
  sponsorshipAnchorId,
}: {
  conferenceId: string;
  conferenceYear: string;
  conferenceEdition: string;
  organizationId: string | null;
  floorPlanUrl: string;
  booths: FloorPlanBooth[];
  myCartOfferIds?: Set<string>;
  membershipGate?: MembershipGate | null;
  /** If set, the legend's track labels link down to the tier comparison section with this id. */
  sponsorshipAnchorId?: string;
}) {
  const svgRef  = useRef<SVGSVGElement | null>(null);
  const [vbH, setVbH]          = useState(600);
  const [zoom, setZoom]        = useState(1);
  const [pan, setPan]          = useState({ x: 0, y: 0 });
  const [hoverId, setHover]    = useState<string | null>(null);
  const [modalBooth, setModal] = useState<FloorPlanBooth | null>(null);
  const panRef     = useRef<{ sx: number; sy: number; px: number; py: number; upu: number } | null>(null);
  const didPanRef  = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const placed = booths.filter(b => b.x != null && b.y != null && b.w != null && b.h != null);

  const fit    = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const zoomBy = (f: number) => {
    setZoom(z => {
      const nz = clamp(z * f, 0.25, 8);
      setPan(p => ({ x: p.x + (VIEW_W / z - VIEW_W / nz) / 2, y: p.y + (vbH / z - vbH / nz) / 2 }));
      return nz;
    });
  };

  const onPanDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    didPanRef.current = false;
    panRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, upu: VIEW_W / zoom / rect.width };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPanMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!panRef.current) return;
    const { sx, sy, px, py, upu } = panRef.current;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPanRef.current = true;
    setPan({ x: px - dx * upu, y: py - dy * upu });
  };
  const onPanUp = () => { panRef.current = null; };

  // Only show the "Connected Sponsor" legend swatch if any booth is flagged that way.
  const hasConnected = booths.some(b => b.color != null);

  // Convert the modal booth's SVG-unit centre to container-% for card placement.
  // Recomputes on every render so the card tracks the booth while panning/zooming.
  const cardPos = modalBooth && modalBooth.x != null && modalBooth.y != null
    ? {
        left: clamp(
          ((modalBooth.x as number + (modalBooth.w as number) / 2) * VIEW_W - pan.x) / (VIEW_W / zoom) * 100,
          2, 98,
        ),
        top: clamp(
          ((modalBooth.y as number + (modalBooth.h as number) / 2) * vbH - pan.y) / (vbH / zoom) * 100,
          2, 98,
        ),
      }
    : null;

  const viewBox = `${pan.x} ${pan.y} ${VIEW_W / zoom} ${vbH / zoom}`;

  // Does this org already hold or have in cart any OTHER booth? Drives the
  // "extra booths don't add meeting time" reassurance note in the popup.
  const alreadyHasAnotherBooth = modalBooth
    ? booths.some(
        b =>
          b.id !== modalBooth.id &&
          (myCartOfferIds.has(b.id) || (!!organizationId && b.soldOrg?.id === organizationId))
      )
    : false;

  return (
    <div className="space-y-3">
      {/* hidden img to derive aspect ratio */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={floorPlanUrl} alt="" className="hidden"
        onLoad={e => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0) setVbH((VIEW_W * img.naturalHeight) / img.naturalWidth);
        }}
      />

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500">
        {(["available", "reserved", "sold"] as const).map(s => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 rounded-sm border border-gray-300"
              style={{ background: STATUS_FILL[s] }} />
            {s === "reserved" ? "in a cart" : s}
          </span>
        ))}

        <span className="h-3 w-px bg-gray-300 mx-1" />

        {sponsorshipAnchorId ? (
          <a href={`#${sponsorshipAnchorId}`} className="flex items-center gap-1.5 hover:text-gray-700 hover:underline">
            <span className="inline-block h-3 w-4 rounded-sm bg-white"
              style={{ border: `2px solid ${TYPE_STROKE.exhibitor}` }} />
            Exhibitor
          </a>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 rounded-sm bg-white"
              style={{ border: `2px solid ${TYPE_STROKE.exhibitor}` }} />
            Exhibitor
          </span>
        )}
        {hasConnected && (
          sponsorshipAnchorId ? (
            <a href={`#${sponsorshipAnchorId}`} className="flex items-center gap-1.5 hover:text-gray-700 hover:underline">
              <span className="inline-block h-3 w-4 rounded-sm bg-white"
                style={{ border: `2px solid ${TYPE_STROKE.connected}` }} />
              Connected Sponsor
            </a>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-4 rounded-sm bg-white"
                style={{ border: `2px solid ${TYPE_STROKE.connected}` }} />
              Connected Sponsor
            </span>
          )
        )}

        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => zoomBy(1.25)}
            className="rounded border border-gray-300 px-2 py-0.5 hover:bg-white">+</button>
          <button type="button" onClick={() => zoomBy(0.8)}
            className="rounded border border-gray-300 px-2 py-0.5 hover:bg-white">−</button>
          <button type="button" onClick={fit}
            className="rounded border border-gray-300 px-2 py-0.5 hover:bg-white">Fit</button>
        </div>
      </div>

      {/* instruction — static, no layout shift */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-2 text-sm text-gray-500">
        Hover a booth for details (sold booths show who&apos;s exhibiting) &middot; drag to pan &middot; scroll or +/− to zoom
      </div>

      {membershipGate && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Your membership doesn&apos;t cover this conference&apos;s dates. Adding a booth will also renew it
          through {formatGateDate(membershipGate.newExpiresAt)}
          {membershipGate.previewPriceCents != null ? ` (${formatCents(membershipGate.previewPriceCents)})` : ""}.
        </div>
      )}

      {/* map container — relative so the anchored card positions inside it */}
      <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className="h-auto w-full touch-none select-none cursor-grab active:cursor-grabbing"
          onPointerDown={onPanDown}
          onPointerMove={onPanMove}
          onPointerUp={onPanUp}
          role="img"
          aria-label="Exhibition floor plan"
        >
          {/* background — click to dismiss card */}
          <rect x={0} y={0} width={VIEW_W} height={vbH} fill="white"
            onClick={() => setModal(null)} />
          <image href={floorPlanUrl} x={0} y={0} width={VIEW_W} height={vbH}
            preserveAspectRatio="none"
            onClick={() => setModal(null)} />

          {placed.map(b => {
            const x   = (b.x as number) * VIEW_W;
            const y   = (b.y as number) * vbH;
            const w   = (b.w as number) * VIEW_W;
            const h   = (b.h as number) * vbH;
            const cx  = x + w / 2;
            const cy  = y + h / 2;
            const rot = b.rotation ?? 0;
            const isHov   = b.id === hoverId;
            const isAvail = b.status === "available";
            const inCart  = myCartOfferIds.has(b.id);
            const isSold  = b.status === "sold";
            const canOpen = isAvail || inCart || isSold;
            const sw = Math.max(0.5, 2 / zoom);
            const typeStroke = b.color != null ? TYPE_STROKE.connected : TYPE_STROKE.exhibitor;
            const textColor = b.status === "sold" ? "#F8FAFC" : "#1E293B";
            const showLogo = isSold && zoom >= LOGO_ZOOM_THRESHOLD && !!b.soldOrg?.logoUrl;
            const showInitial = isSold && zoom >= LOGO_ZOOM_THRESHOLD && !!b.soldOrg && !b.soldOrg.logoUrl;
            // Inset the logo a bit so the booth's own border/fill still frames it as a chip.
            const pad = Math.min(w, h) * 0.12;

            return (
              <g
                key={b.id}
                transform={`rotate(${rot} ${cx} ${cy})`}
                style={{ cursor: canOpen ? "pointer" : "default" }}
                onPointerEnter={() => {
                  setHover(b.id);
                  if (hoverTimer.current) clearTimeout(hoverTimer.current);
                  if (canOpen) {
                    hoverTimer.current = setTimeout(() => {
                      setModal(prev => prev ?? b);
                    }, 420);
                  }
                }}
                onPointerLeave={() => {
                  setHover(null);
                  if (hoverTimer.current) clearTimeout(hoverTimer.current);
                }}
                onClick={e => {
                  // Stop propagation so the click doesn't bubble to the SVG background
                  // and immediately close the card we're about to open.
                  e.stopPropagation();
                  if (hoverTimer.current) clearTimeout(hoverTimer.current);
                  if (!didPanRef.current && canOpen) setModal(b);
                }}
              >
                <rect
                  x={x} y={y} width={w} height={h} rx={3}
                  fill={
                    inCart  ? (isHov ? "#93c5fd" : "#bfdbfe")
                    : isHov ? STATUS_FILL_HOVER[b.status]
                    : STATUS_FILL[b.status]
                  }
                  stroke={typeStroke}
                  strokeWidth={isHov ? sw * 3 : sw * 1.75}
                />
                {showLogo ? (
                  <>
                    <defs>
                      <clipPath id={`booth-logo-clip-${b.id}`}>
                        <rect x={x + pad} y={y + pad} width={w - pad * 2} height={h - pad * 2} rx={2} />
                      </clipPath>
                    </defs>
                    <rect x={x + pad} y={y + pad} width={w - pad * 2} height={h - pad * 2} rx={2} fill="white" />
                    <image
                      href={b.soldOrg!.logoUrl!}
                      x={x + pad} y={y + pad} width={w - pad * 2} height={h - pad * 2}
                      preserveAspectRatio="xMidYMid meet"
                      clipPath={`url(#booth-logo-clip-${b.id})`}
                      pointerEvents="none"
                    />
                  </>
                ) : showInitial ? (
                  <text
                    x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={Math.max(10, 18 / zoom)} fontWeight="bold" pointerEvents="none"
                    fill={b.soldOrg!.type === "Member" ? "#EE2A2E" : "#2563EB"}
                    fontFamily="gotham, Gotham, 'Arial Black', 'Helvetica Neue', Arial, sans-serif"
                  >
                    {b.soldOrg!.name.charAt(0).toUpperCase()}
                  </text>
                ) : (
                  <text
                    x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={Math.max(8, 11 / zoom)} fill={inCart ? "#1E293B" : textColor} pointerEvents="none"
                    fontFamily="gotham, Gotham, 'Arial Black', 'Helvetica Neue', Arial, sans-serif"
                  >
                    {b.number ? `${b.number}` : b.name.slice(0, 8)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Booth tooltip card — absolutely positioned within the map, no layout shift */}
        {modalBooth && cardPos && (
          <BoothCard
            booth={modalBooth}
            posLeft={cardPos.left}
            posTop={cardPos.top}
            conferenceId={conferenceId}
            conferenceYear={conferenceYear}
            conferenceEdition={conferenceEdition}
            organizationId={organizationId}
            myCartOfferIds={myCartOfferIds}
            membershipGate={membershipGate}
            alreadyHasAnotherBooth={alreadyHasAnotherBooth}
            onClose={() => setModal(null)}
          />
        )}
      </div>
    </div>
  );
}
