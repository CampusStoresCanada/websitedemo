"use client";

import { useEffect, useState } from "react";

/**
 * Renders a UTC ISO timestamp in the viewer's own browser timezone. Must be
 * a client component — Date formatting reflects the runtime's local zone,
 * which server-side is the server's zone (UTC on Vercel), not the viewer's.
 * Renders a placeholder until mounted so the server-rendered HTML and the
 * initial client render match (avoids a hydration mismatch); the real local
 * time swaps in right after.
 */
export default function LocalDateTime({
  iso,
  options,
  fallback = "—",
}: {
  iso: string | null;
  options?: Intl.DateTimeFormatOptions;
  fallback?: string;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!iso) return;
    setText(new Date(iso).toLocaleString("en-CA", options));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);

  if (!iso) return <>{fallback}</>;
  return <>{text ?? fallback}</>;
}
