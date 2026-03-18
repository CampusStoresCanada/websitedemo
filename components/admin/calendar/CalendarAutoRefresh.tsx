"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type CalendarAutoRefreshProps = {
  /** Polling interval in ms — capped at 30s max per spec. */
  intervalMs?: number;
};

export default function CalendarAutoRefresh({
  intervalMs = 20000,
}: CalendarAutoRefreshProps) {
  const router = useRouter();
  const lastWatermarkRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    async function checkHeartbeat() {
      if (inFlightRef.current) return;
      if (document.visibilityState !== "visible") return;
      inFlightRef.current = true;
      try {
        const res = await fetch("/api/admin/calendar/heartbeat", {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as { watermark?: string };
        const next = payload.watermark ?? "empty";
        const prev = lastWatermarkRef.current;
        if (prev === null) {
          lastWatermarkRef.current = next;
          return;
        }
        if (next !== prev) {
          lastWatermarkRef.current = next;
          router.refresh();
        }
      } catch {
        // Transient polling error — ignore silently.
      } finally {
        inFlightRef.current = false;
      }
    }

    // Cap at 30 000 ms per spec, floor at 5 000 ms.
    const clampedMs = Math.min(30000, Math.max(5000, intervalMs));
    const timer = window.setInterval(checkHeartbeat, clampedMs);

    const onFocus = () => void checkHeartbeat();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router, intervalMs]);

  return null;
}
