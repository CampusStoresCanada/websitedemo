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
 * Start/end pair for an event. When both fall on the same local calendar day
 * the date is printed once with a time range beneath it — repeating the full
 * weekday-month-day for a two-hour meeting reads as two separate events.
 * Cross-midnight ranges fall back to the explicit "Until <full date>" form.
 */
export function DateTimeRange({ start, end }: { start: string; end?: string | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return <time dateTime={start} />;

  const startDate = parseUTC(start);
  const endDate = end ? parseUTC(end) : null;
  // Compare rendered local dates rather than UTC parts — the viewer's timezone
  // decides whether these are the same day.
  const sameDay =
    endDate !== null &&
    startDate.toLocaleDateString("en-CA") === endDate.toLocaleDateString("en-CA");

  if (!endDate) {
    return (
      <p className="text-sm text-gray-700 font-medium">
        <LocalDate iso={start} />
      </p>
    );
  }

  if (!sameDay) {
    return (
      <>
        <p className="text-sm text-gray-700 font-medium"><LocalDate iso={start} /></p>
        <p className="text-sm text-gray-500 mt-0.5">Until <LocalDate iso={end!} /></p>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-gray-700 font-medium">
        <LocalDate iso={start} format="date-only" />
      </p>
      <p className="text-sm text-gray-500 mt-0.5">
        <time dateTime={start}>
          {startDate.toLocaleString("en-CA", { hour: "numeric", minute: "2-digit" })}
        </time>
        {" \u2013 "}
        <LocalDate iso={end!} format="time-only" />
      </p>
    </>
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
