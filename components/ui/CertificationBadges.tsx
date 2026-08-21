"use client";

import { useState, useRef, useEffect } from "react";
import { CERTIFICATION_BY_NAME, CANCOLL_CERT, type Certification } from "@/lib/certifications";

interface CertificationBadgesProps {
  certifications: string[];
  /** sm = 32px (panels), md = 40px (profile page) */
  size?: "sm" | "md";
  /**
   * Whether CANCOLL should be visible to this viewer.
   * CANCOLL lives in the certifications array but is only shown to members/admins.
   * Defaults to false (hidden from public).
   */
  showCancoll?: boolean;
  /**
   * When provided, badges whose name is in this set are highlighted with a
   * green ring — used to indicate certs that match the viewer's preferences.
   */
  highlightSet?: Set<string>;
  /**
   * DERIVED badges — computed per render (e.g. Exhibitor, from booth
   * ownership) rather than stored in `organizations.certifications`.
   * Rendered after the stored ones. Kept as a separate input on purpose:
   * nothing here can ever be round-tripped back into the DB array by the
   * edit-mode toggles, so a derived badge can't outlive the fact it reflects.
   */
  extraBadges?: Certification[];
}

/**
 * Renders a row of circular certification badge images with hover tooltips.
 * Images load from /certifications/{filename} (defaults to {slug}.svg)
 */
export function CertificationBadges({ certifications, size = "md", showCancoll = false, highlightSet, extraBadges = [] }: CertificationBadgesProps) {
  const certs: Certification[] = certifications
    .filter((name) => name !== "CANCOLL" || showCancoll) // gate CANCOLL by viewer permission
    .map((name) => CERTIFICATION_BY_NAME[name])
    .filter(Boolean) as Certification[];

  const all = [...certs, ...extraBadges];
  if (all.length === 0) return null;

  const px = size === "sm" ? 32 : 40;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {all.map((cert) => (
        <CertBadge
          key={cert.slug}
          name={cert.name}
          filename={cert.filename ?? `${cert.slug}.svg`}
          description={cert.description}
          px={px}
          highlighted={highlightSet ? highlightSet.has(cert.name) : false}
        />
      ))}
    </div>
  );
}

const TOOLTIP_WIDTH = 220;
const TOOLTIP_GAP = 8; // px between badge top and tooltip bottom

function CertBadge({
  name,
  filename,
  description,
  px,
  highlighted = false,
}: {
  name: string;
  filename: string;
  description: string;
  px: number;
  highlighted?: boolean;
}) {
  const badgeRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const showTooltip = () => {
    if (!badgeRef.current) return;
    const rect = badgeRef.current.getBoundingClientRect();

    // Center tooltip horizontally over the badge
    let left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;

    // Keep inside viewport horizontally (8px margin)
    const margin = 8;
    if (left < margin) left = margin;
    if (left + TOOLTIP_WIDTH > window.innerWidth - margin) {
      left = window.innerWidth - margin - TOOLTIP_WIDTH;
    }

    // Place above the badge
    const top = rect.top - TOOLTIP_GAP;

    setPos({ top, left });
  };

  const hideTooltip = () => setPos(null);

  // Clean up on unmount
  useEffect(() => () => setPos(null), []);

  return (
    <div
      ref={badgeRef}
      className="relative flex-shrink-0"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      <img
        src={`/certifications/${filename}`}
        alt={name}
        width={px}
        height={px}
        className={`rounded-full object-contain select-none${highlighted ? " ring-2 ring-green-400 ring-offset-1" : ""}`}
        style={{ width: px, height: px }}
        draggable={false}
      />
      {pos && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ top: pos.top, left: pos.left, width: TOOLTIP_WIDTH }}
        >
          {/* Tooltip box — anchored to its bottom edge so it sits above the badge */}
          <div className="translate-y-[-100%]">
            <div className="bg-gray-900 text-white text-xs rounded-lg px-2.5 py-1.5 text-center shadow-xl">
              <p className="font-semibold whitespace-nowrap">{name}</p>
              <p className="text-gray-300 mt-0.5 leading-snug">{description}</p>
            </div>
            {/* Arrow */}
            <div className="flex justify-center">
              <div className="w-2 h-2 bg-gray-900 rotate-45 -mt-1" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
