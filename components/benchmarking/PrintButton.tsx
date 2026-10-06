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
export default function PrintButton({
  auto = false,
  label = "Print this worksheet",
  className = "rounded-md bg-[#163D6D] px-4 py-2 text-sm font-semibold text-white hover:bg-[#12325a]",
  children,
}: {
  auto?: boolean;
  /** What the button says. The sequencing below is what makes this worth reusing. */
  label?: string;
  className?: string;
  /**
   * Render the control as something other than a line of text — the shipping
   * label on /conference-in-a-box IS the button, so the thing you click is the
   * thing you get. Still a real <button>, so it keeps focus and the keyboard.
   */
  children?: React.ReactNode;
}) {
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

    /*
      ⛔ Wait for THIS page to be on screen, not for the document to say it is
      ready. Every document-level signal is stale on a client-side navigation:
      `load` fired on whatever page you came from and never fires again,
      `readyState` is already "complete", and `document.fonts.ready` is already
      resolved. So arriving here from the survey's Print control — which is a
      router.push — ran this immediately on mount and opened the dialog 50ms
      before React had painted the worksheet. The pages came out blank, while
      pressing the button on the page or the browser's own print worked fine,
      because by then the content was there.

      So the readiness test is the worksheet itself: the sheet is in the DOM and
      has stopped growing across two consecutive frames. That is true on a cold
      load and on a soft navigation, which no document-level flag is.
    */
    const sheetIsSettled = () =>
      new Promise<void>((resolve) => {
        const deadline = Date.now() + 4000;
        let lastHeight = -1;
        let stableFrames = 0;

        const check = () => {
          if (cancelled) return;
          const sheet = document.querySelector<HTMLElement>("[data-worksheet]");
          const height = sheet?.scrollHeight ?? 0;

          if (height > 0 && height === lastHeight) stableFrames += 1;
          else stableFrames = 0;
          lastHeight = height;

          /*
            Two settled frames, or we give up and print anyway. A worksheet that
            prints slightly early is recoverable — the reader presses print
            again. One that never prints because a measurement never settled
            leaves somebody staring at a page wondering what they did wrong.
          */
          if (stableFrames >= 2 || Date.now() > deadline) return resolve();
          timers.push(setTimeout(check, 50));
        };

        check();
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
      await sheetIsSettled();
      if (cancelled) return;
      window.print();
    };

    const cleanup = () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };

    /*
      No `load` listener any more. It cannot fire on a soft navigation, and on a
      cold load sheetIsSettled() already covers the case it was guarding.
    */
    void go();
    return cleanup;
  }, [auto]);

  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {children ?? label}
    </button>
  );
}
