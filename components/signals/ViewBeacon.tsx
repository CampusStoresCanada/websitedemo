"use client";

/**
 * Reports the current path after the page has rendered.
 *
 * ⛔ NOT MOUNTED. Dropping `<ViewBeacon />` into `app/layout.tsx` is the single
 * switch that turns on site-wide behavioural capture for signed-in members. That
 * is a deliberate decision about recording what named people look at, and it is
 * left for a human to make rather than arriving quietly with a merge.
 *
 * When it is mounted, it costs a signed-in visitor one keepalive POST per
 * navigation and nothing on the render path.
 */

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function ViewBeacon() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The path we came FROM — a journey says more than a destination. Arriving at
  // a partner from a category listing is a different act from arriving at it
  // from a link in a post.
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    const query = searchParams?.toString();
    const url = query ? `${pathname}?${query}` : pathname;

    // ⚠️ Same page, same visit — a re-render or a state change is not a view.
    // Without this, any component that re-mounts would inflate a person's
    // interest in whatever they happen to be looking at.
    if (previous.current === url) return;
    const referrer = previous.current;
    previous.current = url;

    const body = JSON.stringify({ path: url, referrer });

    // `keepalive` so the report survives the navigation that triggered it —
    // a plain fetch is cancelled when the page goes away, which loses exactly
    // the views of people moving quickly, who are the most engaged.
    try {
      void fetch("/api/signal/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Never let telemetry break a page.
    }
  }, [pathname, searchParams]);

  return null;
}
