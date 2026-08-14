"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { RenewalDirectoryOrgType, RenewalDirectoryRow } from "@/lib/renewal/renewal-directory";
import { STATUS_META, type OrgMembershipStatus } from "@/lib/membership/types";
import { getConferenceReceiptUrl } from "@/lib/actions/conference-commerce";
import { CircleDMPanel } from "@/components/circle/CircleDMPanel";

const INK = "#16345a";
const RED = "#e72a28";

const TABS: { type: RenewalDirectoryOrgType; label: string }[] = [
  { type: "Member", label: "Members" },
  { type: "Vendor Partner", label: "Partners" },
];

type SortKey = "name" | "status" | "value" | "expiry";

function formatDollars(cents: number | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ─────────────────────────────────────────────────────────────────
// Invoice status icon — green/paid, yellow/open, red/other, click
// downloads the real PDF or, for bundled-checkout renewals with no
// standalone invoice, opens the Stripe charge receipt instead.
// ─────────────────────────────────────────────────────────────────

function invoiceColor(row: RenewalDirectoryRow): string | null {
  if (row.invoicePdfUrl) {
    if (row.invoiceStatus === "paid") return "#16a34a";
    if (row.invoiceStatus === "draft" || row.invoiceStatus === "invoiced") return "#ca8a04";
    return "#dc2626";
  }
  if (row.receiptOrderId) return "#16a34a"; // a receipt only exists once paid
  return null;
}

function InvoiceButton({ row }: { row: RenewalDirectoryRow }) {
  const color = invoiceColor(row);
  const [loading, setLoading] = useState(false);

  if (!color) return <span className="inline-block w-9 h-9" />;

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (row.invoicePdfUrl) {
      window.open(row.invoicePdfUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (row.receiptOrderId) {
      setLoading(true);
      try {
        const result = await getConferenceReceiptUrl(row.receiptOrderId);
        if (result.success && result.data.url) {
          window.open(result.data.url, "_blank", "noopener,noreferrer");
        }
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="flex items-center justify-center w-9 h-9 rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      style={{ background: color }}
      aria-label={row.invoicePdfUrl ? "Download invoice" : "View receipt"}
      title={row.invoicePdfUrl ? "Download invoice" : "View receipt"}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" />
      </svg>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Org-admin name — Circle DM when the contact has a linked Circle
// account, mailto fallback otherwise (including when the viewer
// themselves isn't Circle-linked, or the API call fails).
// ─────────────────────────────────────────────────────────────────

function OrgAdminLink({
  row,
  onOpenDM,
}: {
  row: RenewalDirectoryRow;
  onOpenDM: (roomUuid: string, label: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  if (!row.orgAdminName) return null;

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!row.orgAdminCircleId) {
      if (row.orgAdminEmail) window.location.href = `mailto:${row.orgAdminEmail}`;
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/circle/dm/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCircleId: row.orgAdminCircleId }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      onOpenDM(data.room.uuid, row.orgAdminName!);
    } catch {
      if (row.orgAdminEmail) window.location.href = `mailto:${row.orgAdminEmail}`;
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="text-left text-[12.5px] text-gray-400 hover:text-[#16345a] hover:underline disabled:opacity-60"
    >
      {row.orgAdminName}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────

function DirectoryRow({
  row,
  onOpenDM,
}: {
  row: RenewalDirectoryRow;
  onOpenDM: (roomUuid: string, label: string) => void;
}) {
  const meta = row.membershipStatus ? STATUS_META[row.membershipStatus as OrgMembershipStatus] : null;

  return (
    <div className="flex items-center gap-5 rounded-xl px-[18px] py-4 odd:bg-white/60">
      <div className="w-14 h-14 rounded-full bg-gray-300 flex items-center justify-center text-white font-medium text-base overflow-hidden shrink-0">
        {row.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.logoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          initials(row.name)
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium text-[15.5px] leading-tight" style={{ color: INK }}>
          {row.name}
        </div>
        <OrgAdminLink row={row} onOpenDM={onOpenDM} />
      </div>

      <Link
        href={`/org/${row.slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-[#16345a] hover:bg-[#16345a]/10 shrink-0"
        title="View organization"
        aria-label={`View ${row.name}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"
          />
        </svg>
      </Link>

      <div className="flex items-center gap-7 shrink-0">
        {meta ? (
          <span
            className={`inline-flex items-center justify-center w-[132px] rounded-lg px-2.5 py-2 text-xs font-semibold whitespace-nowrap ${meta.bgClass} ${meta.textClass} ${
              row.membershipStatus === "canceled" ? "line-through" : ""
            }`}
          >
            {meta.label}
          </span>
        ) : (
          <span className="inline-block w-[132px]" />
        )}

        {row.typeClass ? (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-[11.5px]"
            style={{ background: INK }}
          >
            {row.typeClass}
          </div>
        ) : (
          <span className="inline-block w-9 h-9" />
        )}

        <div
          className="w-16 text-center font-medium text-[15.5px] tabular-nums"
          style={{ color: row.renewalAmountCents == null ? "#b6b6b6" : INK }}
        >
          {formatDollars(row.renewalAmountCents)}
        </div>

        <InvoiceButton row={row} />

        <button
          type="button"
          disabled
          className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-300 cursor-not-allowed"
          aria-label="More actions (coming soon)"
        >
          <svg width="15" height="4" viewBox="0 0 16 4" fill="currentColor">
            <circle cx="1.85" cy="2" r="1.85" />
            <circle cx="8" cy="2" r="1.85" />
            <circle cx="14.15" cy="2" r="1.85" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Widget
// ─────────────────────────────────────────────────────────────────

export function RenewalsDirectory({ rows }: { rows: RenewalDirectoryRow[] }) {
  const [activeType, setActiveType] = useState<RenewalDirectoryOrgType>("Member");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("name");
  const [refineOpen, setRefineOpen] = useState(false);
  const [dm, setDm] = useState<{ roomUuid: string; label: string } | null>(null);
  const refineRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const c: Record<RenewalDirectoryOrgType, number> = { Member: 0, "Vendor Partner": 0 };
    for (const r of rows) c[r.type]++;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    let list = rows.filter((r) => r.type === activeType);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q));
    }
    if (statusFilter.size > 0) {
      list = list.filter((r) => r.membershipStatus && statusFilter.has(r.membershipStatus));
    }

    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "status") return (a.membershipStatus ?? "").localeCompare(b.membershipStatus ?? "");
      if (sort === "value") return (b.renewalAmountCents ?? -1) - (a.renewalAmountCents ?? -1);
      if (sort === "expiry") return (a.membershipExpiresAt ?? "").localeCompare(b.membershipExpiresAt ?? "");
      return 0;
    });

    return list;
  }, [rows, activeType, search, statusFilter, sort]);

  function toggleStatus(status: string) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  const statusesInTab = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.type === activeType && r.membershipStatus) set.add(r.membershipStatus);
    }
    return set;
  }, [rows, activeType]);

  return (
    <div className="rounded-2xl p-7 pb-5" style={{ background: "#e5e5e5" }} onClick={() => setRefineOpen(false)}>
      <p className="font-bold uppercase tracking-wide mb-4" style={{ color: RED, fontSize: 34 }}>
        Renewals
      </p>

      <div className="flex gap-7 border-b mb-4" style={{ borderColor: "rgba(22,52,90,0.15)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.type}
            type="button"
            onClick={() => setActiveType(tab.type)}
            className="pb-2.5 text-[15px] relative"
            style={{
              color: activeType === tab.type ? INK : "#999",
              fontWeight: activeType === tab.type ? 500 : 400,
              borderBottom: activeType === tab.type ? `2.5px solid ${INK}` : "2.5px solid transparent",
            }}
          >
            {tab.label} <span className="opacity-60 text-[0.85em]">({counts[tab.type]})</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2.5 flex-wrap mb-3.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search org name..."
          className="text-[13px] px-3 py-1.5 rounded-lg border bg-white w-56"
          style={{ borderColor: "rgba(22,52,90,0.18)" }}
          onClick={(e) => e.stopPropagation()}
        />

        <div className="relative" ref={refineRef} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setRefineOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-full border border-dashed"
            style={{ borderColor: "rgba(22,52,90,0.35)", color: INK }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M12 4v16m8-8H4" />
            </svg>
            Refine
          </button>
          {refineOpen && (
            <div
              className="absolute top-8 left-0 z-10 w-60 bg-white rounded-lg border shadow-lg overflow-hidden"
              style={{ borderColor: "rgba(22,52,90,0.15)" }}
            >
              <div className="p-3 border-b" style={{ borderColor: "rgba(22,52,90,0.08)" }}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Status</div>
                {Array.from(statusesInTab).map((status) => (
                  <label key={status} className="flex items-center gap-1.5 text-[12.5px] py-1 cursor-pointer" style={{ color: INK }}>
                    <input
                      type="checkbox"
                      checked={statusFilter.has(status)}
                      onChange={() => toggleStatus(status)}
                    />
                    {STATUS_META[status as OrgMembershipStatus]?.label ?? status}
                  </label>
                ))}
              </div>
              <div className="p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Sort by</div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="w-full text-[12.5px] px-2 py-1.5 rounded-md border bg-gray-50"
                  style={{ borderColor: "rgba(22,52,90,0.18)" }}
                >
                  <option value="name">Name (A–Z)</option>
                  <option value="status">Status</option>
                  <option value="value">Renewal value (high–low)</option>
                  <option value="expiry">Expiry date</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <span className="ml-auto text-[11.5px] text-gray-500">
          {visible.length} result{visible.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {visible.map((row) => (
          <DirectoryRow key={row.id} row={row} onOpenDM={(roomUuid, label) => setDm({ roomUuid, label })} />
        ))}
        {visible.length === 0 && (
          <p className="text-center py-10 text-gray-400 text-sm">No organizations match your filters.</p>
        )}
      </div>

      <CircleDMPanel
        isOpen={!!dm}
        onClose={() => setDm(null)}
        initialRoomUuid={dm?.roomUuid}
        initialRoomLabel={dm?.label}
      />
    </div>
  );
}
