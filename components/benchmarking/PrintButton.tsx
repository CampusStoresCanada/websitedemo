"use client";

import { useEffect } from "react";

/**
 * The only interactive thing on the worksheet, so it is the only part that
 * needs to be a client component. Everything else renders on the server and
 * prints without JavaScript — which matters, because a printed sheet should not
 * depend on a bundle having loaded.
 *
 * `auto` is set when somebody arrived here from the survey's Print control
 * rather than by browsing. They already asked for paper, so the dialogue opens
 * itself instead of making them ask a second time on a page they did not want
 * to read.
 */
export default function PrintButton({ auto = false }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;

    /*
      ⛔ No "have I already fired" ref here.

      There was one, to stop a double dialogue. In development StrictMode mounts
      effects twice: the first run set the ref and was then cancelled by its own
      cleanup, and the second run saw the ref already set and returned. Net
      effect, nothing ever printed — and because StrictMode does not
      double-invoke in production, it worked there and only failed in front of
      whoever was testing it. `cancelled` below already makes a superseded run
      harmless, which is the guard that was actually needed.
    */

    /*
      ⛔ Never print on mount alone.

      The letterhead is a plain <img> and the tables are sized in millimetres
      against a loaded font. Firing the dialogue before either has landed prints
      a sheet with a gap where the logo goes and column widths measured against
      a fallback face — and the reader has no way to tell that what came out of
      the tray is not what the page would have shown them. So: wait for the
      window load event (images included), then for fonts, then a beat for
      layout to settle.

      ⛔ And no requestAnimationFrame anywhere in that chain. rAF is paused
      while the document is hidden, which is exactly what a ⌘-clicked link is:
      the dialogue never opened, and then fired at whatever later moment the
      reader happened to switch to the tab. Timers run in hidden documents;
      frames do not. Printing is also meaningless until the page is actually on
      screen, so a hidden document waits to be looked at first.
    */
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const whenVisible = () =>
      new Promise<void>((resolve) => {
        if (!document.hidden) return resolve();
        const onVisible = () => {
          if (document.hidden) return;
          document.removeEventListener("visibilitychange", onVisible);
          resolve();
        };
        document.addEventListener("visibilitychange", onVisible);
      });

    const go = async () => {
      try {
        await document.fonts?.ready;
      } catch {
        // A browser without the font-loading API still prints fine.
      }
      if (cancelled) return;
      await whenVisible();
      if (cancelled) return;
      timers.push(
        setTimeout(() => {
          if (!cancelled) window.print();
        }, 50),
      );
    };

    const cleanup = () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };

    if (document.readyState === "complete") {
      void go();
      return cleanup;
    }

    const onLoad = () => void go();
    window.addEventListener("load", onLoad);
    return () => {
      cleanup();
      window.removeEventListener("load", onLoad);
    };
  }, [auto]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-[#163D6D] px-4 py-2 text-sm font-semibold text-white hover:bg-[#12325a]"
    >
      Print this worksheet
    </button>
  );
}
