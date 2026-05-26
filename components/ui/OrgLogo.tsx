"use client";

import { useState } from "react";

interface OrgLogoProps {
  name: string;
  logoUrl: string | null | undefined;
  className?: string;
  imgClassName?: string;
}

/** Deterministic muted colour from org name — consistent across renders */
function nameToColor(name: string): string {
  const palette = [
    "#CBD5E1", // slate
    "#C7D2FE", // indigo
    "#BAE6FD", // sky
    "#A7F3D0", // emerald
    "#FDE68A", // amber
    "#FECACA", // red
    "#DDD6FE", // violet
    "#FBCFE8", // pink
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function OrgLogo({ name, logoUrl, className = "", imgClassName = "" }: OrgLogoProps) {
  const [failed, setFailed] = useState(false);

  const wrapClass = `flex items-center justify-center overflow-hidden ${className}`;

  if (logoUrl && !failed) {
    return (
      <div className={wrapClass}>
        <img
          src={logoUrl}
          alt={name}
          onError={() => setFailed(true)}
          className={`w-full h-full object-contain ${imgClassName}`}
        />
      </div>
    );
  }

  // Fallback: coloured square with initials
  return (
    <div
      className={`${wrapClass} select-none`}
      style={{ backgroundColor: nameToColor(name) }}
      aria-label={name}
    >
      <span className="text-gray-700 font-semibold text-xs leading-none">
        {initials(name)}
      </span>
    </div>
  );
}
