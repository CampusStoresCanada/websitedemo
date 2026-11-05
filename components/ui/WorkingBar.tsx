"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * A thin bar along the top of every page while the site waits on its server
 * (Steve, 2026-11-05): members on a slow rural or satellite connection read a
 * page that sits still for five seconds as broken.
 *
 * ⛔ One place, not a spinner per button. It watches the site's own requests
 * to its server, the ones Next makes for a server action (a `Next-Action`
 * header) or for a page's content (`RSC`), so every button and page gets it
 * without being touched.
 *
 * Only what the person did: a request counts when it starts within a moment
 * of a click, a key or a form change, or while (or just after) another one
 * they started is still going, which covers the refresh that follows a save.
 * The check-in desk, the print station and the War Room poll on their own
 * every few seconds; those are not the person waiting, and a bar flashing
 * every three seconds would teach people to ignore it. Prefetches are never
 * counted.
 *
 * A plain link that loads a whole new page starts the bar when clicked; the
 * browser's own loading takes over from there.
 */

const SHOW_AFTER_MS = 300;
const SLOW_AFTER_MS = 8000;
const INTERACTION_WINDOW_MS = 1500;
const CHAIN_WINDOW_MS = 600;

type Listener = (busy: boolean) => void;

const state = {
  installed: false,
  inFlight: 0,
  lastInteraction: 0,
  lastUserRequestEnd: 0,
  navigating: false,
  listeners: new Set<Listener>(),
};

function notify() {
  const busy = state.inFlight > 0 || state.navigating;
  for (const listener of state.listeners) listener(busy);
}

function headerOf(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string | null {
  const fromInit = init?.headers;
  if (fromInit) {
    if (fromInit instanceof Headers) return fromInit.get(name);
    if (Array.isArray(fromInit)) {
      const hit = fromInit.find(([key]) => key.toLowerCase() === name.toLowerCase());
      return hit ? hit[1] : null;
    }
    const key = Object.keys(fromInit).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key) return (fromInit as Record<string, string>)[key];
  }
  return input instanceof Request ? input.headers.get(name) : null;
}

/** A request to the site's own server that someone is waiting on. */
function isSiteWork(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  if (headerOf(input, init, "next-router-prefetch") || headerOf(input, init, "next-router-segment-prefetch")) {
    return false;
  }
  return Boolean(headerOf(input, init, "next-action") || headerOf(input, init, "rsc"));
}

function startedByThePerson(): boolean {
  const now = Date.now();
  return (
    now - state.lastInteraction < INTERACTION_WINDOW_MS ||
    state.inFlight > 0 ||
    now - state.lastUserRequestEnd < CHAIN_WINDOW_MS
  );
}

function install() {
  if (state.installed || typeof window === "undefined") return;
  state.installed = true;

  const markInteraction = () => {
    state.lastInteraction = Date.now();
  };
  for (const type of ["pointerdown", "keydown", "change", "submit"]) {
    window.addEventListener(type, markInteraction, { capture: true, passive: true });
  }

  // A plain same-site link that loads a new page: the bar starts on the click.
  window.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const sameDocument = url.pathname === window.location.pathname && url.search === window.location.search;
      if (sameDocument) return; // a #section on this page, or nowhere new
      state.navigating = true;
      notify();
      // Never stuck on: a navigation that went nowhere stops the bar after a while.
      window.setTimeout(() => {
        state.navigating = false;
        notify();
      }, 15000);
    },
    { capture: false }
  );
  window.addEventListener("pageshow", () => {
    state.navigating = false;
    notify();
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isSiteWork(input, init) || !startedByThePerson()) return originalFetch(input, init);
    state.inFlight += 1;
    notify();
    const settle = () => {
      state.inFlight = Math.max(0, state.inFlight - 1);
      state.lastUserRequestEnd = Date.now();
      notify();
    };
    return originalFetch(input, init).then(
      (response) => {
        settle();
        return response;
      },
      (error: unknown) => {
        settle();
        throw error;
      }
    );
  };
}

export default function WorkingBar() {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    install();
    state.listeners.add(setBusy);
    return () => {
      state.listeners.delete(setBusy);
    };
  }, []);

  // A navigation inside the site has landed once the path changes.
  useEffect(() => {
    if (state.navigating) {
      state.navigating = false;
      notify();
    }
  }, [pathname]);

  // Shown only once a wait passes SHOW_AFTER_MS, so a quick save never flashes.
  useEffect(() => {
    if (!busy) return;
    const show = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(slowTimer);
      setVisible(false);
      setSlow(false);
    };
  }, [busy]);

  if (!visible) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[400]">
      <style>{`@keyframes csc-working-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`}</style>
      <div className="h-1 w-full overflow-hidden bg-[#EE2A2E]/20">
        <div className="h-full w-1/4 bg-[#EE2A2E]" style={{ animation: "csc-working-bar 1.2s ease-in-out infinite" }} />
      </div>
      {slow ? (
        <p className="mx-auto mt-2 w-fit rounded-full bg-white/95 px-3 py-1 text-xs text-gray-700 shadow">
          Still working. Slow connections can take a little longer.
        </p>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );
}
