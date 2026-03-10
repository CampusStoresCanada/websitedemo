"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type BadgeJobsAutoRefreshProps = {
  conferenceId: string;
  intervalMs?: number;
};

export default function BadgeJobsAutoRefresh({
  conferenceId,
  intervalMs = 4000,
}: BadgeJobsAutoRefreshProps) {
  const router = useRouter();
  const lastWatermarkRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    async function checkHeartbeat() {
      if (inFlightRef.current) return;
      if (document.visibilityState !== "visible") return;
      inFlightRef.current = true;
      try {
        const response = await fetch(
          `/api/admin/conference/${conferenceId}/badges/jobs/heartbeat`,
          {
            method: "GET",
            cache: "no-store",
          }
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { watermark?: string };
        const nextWatermark = payload.watermark ?? "empty";
        const previous = lastWatermarkRef.current;
        if (previous === null) {
          lastWatermarkRef.current = nextWatermark;
          return;
        }
        if (nextWatermark !== previous) {
          lastWatermarkRef.current = nextWatermark;
          router.refresh();
        }
      } catch {
        // Ignore transient polling errors.
      } finally {
        inFlightRef.current = false;
      }
    }

    const timer = window.setInterval(checkHeartbeat, Math.max(2000, intervalMs));
    const onFocus = () => {
      void checkHeartbeat();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router, conferenceId, intervalMs]);

  return null;
}
