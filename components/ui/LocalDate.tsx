"use client";

import { useState, useEffect } from "react";
import { parseUTC } from "@/lib/utils";

export { parseUTC };

interface LocalDateProps {
  iso: string;
  format?: "full" | "date-only" | "time-only" | "short" | "compact" | "compact-date" | "compact-time";
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
  compact: {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  },
  "compact-date": {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  },
  "compact-time": {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  },
};

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

/**
 * Drop-in replacement for `toDisplayDate()` — handles null/undefined with "Never" fallback.
 * Use in server component JSX: `<Timestamp iso={row.created_at} />`
 */
export function Timestamp({
  iso,
  format = "compact",
  fallback = "Never",
}: {
  iso: string | null | undefined;
  format?: LocalDateProps["format"];
  fallback?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!iso) return <span>{fallback}</span>;
  if (!mounted) return <time dateTime={iso} />;

  return (
    <time dateTime={iso}>
      {parseUTC(iso).toLocaleString("en-CA", OPTIONS[format])}
    </time>
  );
}
