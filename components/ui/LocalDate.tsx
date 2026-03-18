"use client";

import { useState, useEffect } from "react";

interface LocalDateProps {
  iso: string;
  format?: "full" | "date-only" | "time-only" | "short";
}

const OPTIONS: Record<NonNullable<LocalDateProps["format"]>, Intl.DateTimeFormatOptions> = {
  full: {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  },
  "date-only": {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  },
  "time-only": {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  },
  short: {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  },
};

/** Supabase returns "YYYY-MM-DD HH:mm:ss" with no tz marker — JS treats that
 *  as local time, not UTC. Append "Z" to force UTC interpretation. */
function parseUTC(s: string): Date {
  const utc = s.endsWith("Z") || s.includes("+") ? s : s.replace(" ", "T") + "Z";
  return new Date(utc);
}

export default function LocalDate({ iso, format = "full" }: LocalDateProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Render nothing until we're on the client — avoids any server/client timezone mismatch.
  if (!mounted) return <time dateTime={iso} />;

  return (
    <time dateTime={iso}>
      {parseUTC(iso).toLocaleString("en-CA", OPTIONS[format])}
    </time>
  );
}
