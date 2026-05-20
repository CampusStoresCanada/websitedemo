"use client";

/**
 * SponsorTierBadge
 *
 * Renders the exact Lucide icon (Award / Trophy / Shield) in the tier colour,
 * with a white circle behind the logo zone so the org logo reads cleanly.
 *
 * All paths use fill="none" stroke={color} strokeWidth="2" — exactly how
 * Lucide renders them — so the output is indistinguishable from the icon set.
 */

import { useId } from "react";
import type { TierIcon } from "@/lib/sponsorship/types";
import {
  SHIELD_PATH,
  AWARD_RIBBON,
  TROPHY_CUP, TROPHY_LH, TROPHY_RH, TROPHY_LLEG, TROPHY_RLEG, TROPHY_BASE,
  LOGO_ZONES,
  STROKE_WIDTH,
  HALO_STROKE_WIDTH,
} from "@/lib/sponsorship/iconData";

// ── Shared stroke props ───────────────────────────────────────────

const S = {
  fill: "none",
  strokeWidth: STROKE_WIDTH,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const HALO = {
  fill: "none",
  stroke: "white",
  strokeWidth: HALO_STROKE_WIDTH,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// ── Shape renderers ───────────────────────────────────────────────

function ShieldShape({ color }: { color: string }) {
  return (
    <>
      <path d={SHIELD_PATH} {...HALO} />
      <path d={SHIELD_PATH} stroke={color} {...S} />
    </>
  );
}

function AwardShape({ color }: { color: string }) {
  return (
    <>
      {/* White halo layer */}
      <circle cx="12" cy="8" r="6" {...HALO} />
      <path d={AWARD_RIBBON} {...HALO} />
      {/* Colour layer */}
      <circle cx="12" cy="8" r="6" stroke={color} {...S} />
      <path d={AWARD_RIBBON} stroke={color} {...S} />
    </>
  );
}

function TrophyShape({ color }: { color: string }) {
  return (
    <>
      {/* White halo layer */}
      <path d={TROPHY_CUP}  {...HALO} />
      <path d={TROPHY_LH}   {...HALO} />
      <path d={TROPHY_RH}   {...HALO} />
      <path d={TROPHY_LLEG} {...HALO} />
      <path d={TROPHY_RLEG} {...HALO} />
      <path d={TROPHY_BASE} {...HALO} />
      {/* Colour layer */}
      <path d={TROPHY_CUP}  stroke={color} {...S} />
      <path d={TROPHY_LH}   stroke={color} {...S} />
      <path d={TROPHY_RH}   stroke={color} {...S} />
      <path d={TROPHY_LLEG} stroke={color} {...S} />
      <path d={TROPHY_RLEG} stroke={color} {...S} />
      <path d={TROPHY_BASE} stroke={color} {...S} />
    </>
  );
}

// ── Full badge ────────────────────────────────────────────────────

interface SponsorTierBadgeProps {
  icon: TierIcon | null;
  color: string;
  logoUrl?: string | null;
  name?: string;
  size?: number;
  className?: string;
}

export default function SponsorTierBadge({
  icon,
  color,
  logoUrl,
  name,
  size = 48,
  className,
}: SponsorTierBadgeProps) {
  const uid = useId();
  const shapeKey: TierIcon = icon ?? "shield";
  const { cx, cy, r } = LOGO_ZONES[shapeKey];
  const maskId = `${uid}-logo`;
  const initials = name ? name.charAt(0).toUpperCase() : "?";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.28))" }}
      aria-label={name ? `${name} sponsor badge` : "Sponsor badge"}
    >
      <defs>
        <clipPath id={maskId}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>

      {/* Lucide icon — exact stroke rendering */}
      {shapeKey === "shield" && <ShieldShape color={color} />}
      {shapeKey === "award"  && <AwardShape  color={color} />}
      {shapeKey === "trophy" && <TrophyShape color={color} />}

      {/* White backing so logo reads on any background */}
      <circle cx={cx} cy={cy} r={r} fill="white" />

      {/* Logo or initials */}
      {logoUrl ? (
        <image
          href={logoUrl}
          x={cx - r} y={cy - r}
          width={r * 2} height={r * 2}
          clipPath={`url(#${maskId})`}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        <text
          x={cx} y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={r * 1.0}
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
          fill={color}
          clipPath={`url(#${maskId})`}
        >
          {initials}
        </text>
      )}
    </svg>
  );
}

// ── Picker preview (no logo needed) ──────────────────────────────

export function TierIconPreview({
  icon,
  color,
  size = 40,
  className,
}: {
  icon: TierIcon;
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      {icon === "shield" && <ShieldShape color={color} />}
      {icon === "award"  && <AwardShape  color={color} />}
      {icon === "trophy" && <TrophyShape color={color} />}
    </svg>
  );
}
