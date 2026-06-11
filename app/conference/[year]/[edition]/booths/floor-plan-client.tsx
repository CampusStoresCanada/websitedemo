"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BoothRow, BoothStatus } from "@/lib/actions/conference-booths";
import {
  FLOOR_PLAN_SVG_W as SVG_W,
  FLOOR_PLAN_SVG_H as SVG_H,
  DEFAULT_FLOOR_PLAN_URL,
  BOOTH_STATUS_COLORS as STATUS_COLORS,
  BOOTH_STATUS_BORDER_COLORS as STATUS_BORDER,
  BOOTH_STATUS_LABELS as STATUS_LABEL,
  type BoothPackage,
} from "@/lib/constants/floor-plan";

type Props = {
  booths: BoothRow[];
  boothPackages: BoothPackage[];
  canSelect: boolean;
  year: string;
  edition: string;
  selectedOrgId: string | null;
  floorPlanUrl?: string | null;
};

type DetailPanel = {
  booth: BoothRow;
  x: number;
  y: number;
};

const AVAILABLE_COLORS = ["text-blue-700", "text-green-700", "text-purple-700", "text-amber-700"];

export default function FloorPlanClient({
  booths,
  boothPackages,
  canSelect,
  year,
  edition,
  selectedOrgId,
  floorPlanUrl,
}: Props) {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPanel | null>(null);

  function pct(value: number, total: number): string {
    return `${((value / total) * 100).toFixed(4)}%`;
  }

  function handleBoothClick(booth: BoothRow, e: React.MouseEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget.closest(".floor-plan-container") as HTMLElement)?.getBoundingClientRect();
    const x = e.clientX - (rect?.left ?? 0);
    const y = e.clientY - (rect?.top ?? 0);
    setDetail({ booth, x, y });
  }

  function handleSelectBooth(booth: BoothRow) {
    if (!selectedOrgId) return;
    router.push(
      `/conference/${year}/${edition}/booths/${booth.id}/purchase?org=${selectedOrgId}`
    );
  }

  const packageMap = new Map(boothPackages.map((p) => [p.id, p]));

  return (
    <div className="space-y-4">
      {/* Legend + stats */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-xs">
          {Object.entries(STATUS_LABEL).map(([status, label]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm border"
                style={{
                  background: STATUS_COLORS[status as BoothStatus],
                  borderColor: STATUS_BORDER[status as BoothStatus],
                }}
              />
              {label}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600">
          {boothPackages.map((pkg, i) => {
            const available = booths.filter(
              (b) => b.booth_product_id === pkg.id && b.status === "available"
            ).length;
            return (
              <span key={pkg.id}>
                <span className={`font-semibold ${AVAILABLE_COLORS[i % AVAILABLE_COLORS.length]}`}>
                  {available}
                </span>{" "}
                {pkg.name} available
              </span>
            );
          })}
        </div>
      </div>

      {/* Floor plan */}
      <div
        className="floor-plan-container relative w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
        style={{ paddingBottom: `${(SVG_H / SVG_W) * 100}%` }}
        onClick={() => setDetail(null)}
      >
        {/* Background SVG */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={floorPlanUrl ?? DEFAULT_FLOOR_PLAN_URL}
          alt="Conference floor plan"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />

        {/* Booth overlays */}
        {booths.map((booth) => {
          const left = booth.map_cx - booth.map_w / 2;
          const top = booth.map_cy - booth.map_h / 2;
          const isAvailable = booth.status === "available";
          const isHovered = hovered === booth.id;

          return (
            <button
              key={booth.id}
              type="button"
              className="absolute transition-all duration-100 focus:outline-none"
              style={{
                left: pct(left, SVG_W),
                top: pct(top, SVG_H),
                width: pct(booth.map_w, SVG_W),
                height: pct(booth.map_h, SVG_H),
                // Fill matches the floor-plan-container's background (white)
                // so booths read as cutouts rather than colored blocks; the
                // border still carries the status color.
                background: isHovered
                  ? isAvailable
                    ? "rgba(34, 197, 94, 0.65)"
                    : STATUS_COLORS[booth.status]
                  : "#ffffff",
                border: `2px solid ${STATUS_BORDER[booth.status]}`,
                borderRadius: "3px",
                cursor: isAvailable && canSelect ? "pointer" : "default",
                transform: isHovered ? "scale(1.05)" : undefined,
                zIndex: isHovered ? 20 : 10,
              }}
              onMouseEnter={() => setHovered(booth.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={(e) => handleBoothClick(booth, e)}
              aria-label={`Booth ${booth.booth_number} — ${STATUS_LABEL[booth.status]}`}
            />
          );
        })}

        {/* Detail panel */}
        {detail && (
          <DetailCard
            detail={detail}
            canSelect={canSelect}
            hasOrg={!!selectedOrgId}
            packageMap={packageMap}
            onSelect={handleSelectBooth}
            onClose={() => setDetail(null)}
          />
        )}
      </div>

      {/* Mobile fallback list */}
      <details className="rounded-lg border border-gray-200 text-sm">
        <summary className="cursor-pointer px-4 py-3 font-medium text-gray-700">
          View booth list ({booths.length} booths)
        </summary>
        <div className="divide-y divide-gray-100">
          {booths.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between px-4 py-2"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ background: STATUS_BORDER[b.status] }}
                />
                <span className="font-mono text-xs text-gray-500">{b.booth_number}</span>
                <span className="text-gray-900">
                  {packageMap.get(b.booth_product_id ?? "")?.name ?? "Unassigned"}
                </span>
                {b.organization_name && (
                  <span className="text-gray-500">{b.organization_name}</span>
                )}
              </div>
              <span className="text-xs text-gray-500">{STATUS_LABEL[b.status]}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function DetailCard({
  detail,
  canSelect,
  hasOrg,
  packageMap,
  onSelect,
  onClose,
}: {
  detail: DetailPanel;
  canSelect: boolean;
  hasOrg: boolean;
  packageMap: Map<string, BoothPackage>;
  onSelect: (booth: BoothRow) => void;
  onClose: () => void;
}) {
  const { booth } = detail;
  const isAvailable = booth.status === "available";
  const pkg = packageMap.get(booth.booth_product_id ?? "");
  const CARD_W = 220;
  const CARD_H = 160;

  // Position card within the container using percentage-based offsets
  // Clamp so the card doesn't overflow the right/bottom edges
  const leftPct = Math.min((detail.x / SVG_W) * 100, 85);
  const topPct = Math.min((detail.y / SVG_H) * 100, 75);

  return (
    <div
      className="absolute z-30 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: CARD_W,
        minHeight: CARD_H,
        transform: "translate(-10px, -10px)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-bold text-gray-900">Booth {booth.booth_number}</div>
          <div className="text-xs text-gray-500">{pkg?.name ?? "Unassigned"}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: STATUS_BORDER[booth.status] }}
        />
        <span className="text-sm">{STATUS_LABEL[booth.status]}</span>
      </div>

      {booth.organization_name && (
        <div className="mt-1 text-xs text-gray-600">{booth.organization_name}</div>
      )}

      {booth.status === "reserved" && booth.reserved_until && (
        <div className="mt-1 text-xs text-amber-600">
          Hold expires {new Date(
            booth.reserved_until.endsWith("Z") || booth.reserved_until.includes("+")
              ? booth.reserved_until
              : booth.reserved_until.replace(" ", "T") + "Z"
          ).toLocaleTimeString()}
        </div>
      )}

      {isAvailable && (
        <div className="mt-3">
          {canSelect && hasOrg ? (
            <button
              type="button"
              onClick={() => onSelect(booth)}
              className="w-full rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
            >
              Select this booth →
            </button>
          ) : !hasOrg ? (
            <p className="text-xs text-gray-500">Select an organization to purchase.</p>
          ) : (
            <p className="text-xs text-gray-500">Booth selection is not yet open.</p>
          )}
        </div>
      )}

      {pkg && (
        <div className="mt-2 text-xs text-gray-400">
          ${(pkg.price_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })} + partnership
        </div>
      )}
    </div>
  );
}
