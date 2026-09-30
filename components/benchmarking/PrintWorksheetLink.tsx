"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Print, from inside the survey.
 *
 * Two ways in, because people reach for paper two ways:
 *
 *   1. The visible control. Sends them to the worksheet with the dialogue
 *      already opening, so "Print" means paper rather than meaning "here is
 *      another page to read and a second button to find".
 *
 *   2. ⌘P / Ctrl+P. Printing the form itself produces a stack of collapsed
 *      sections, disabled selects and a save indicator — a document that looks
 *      like a survey but cannot be filled in or read back. So the shortcut is
 *      taken over and pointed at the worksheet, which is the printable version
 *      of the same questions.
 *
 * ⚠️ The shortcut is the only print path a page can intercept. File → Print
 * from the browser's own menu, and the print button in the site toolkit, both
 * go straight to the current document and cannot be redirected — nothing a page
 * does can reach them. That path is handled in CSS instead, in
 * BenchmarkingSurveyForm: the form body is `print:hidden` and a print-only note
 * takes its place, so a menu print comes out as one sheet saying where the
 * worksheet is rather than as thirty sheets of dead form controls.
 */
export default function PrintWorksheetLink() {
  const router = useRouter();
  const params = useSearchParams();

  /*
    Scoped exactly like the survey it sits on. An admin filling one store's
    submission prints that store's worksheet, not their own.

    ⛔ These are carried, never trusted: the worksheet re-resolves the acting
    org server-side through resolveActingOrg, so a hand-edited org id gets
    whatever the reader is actually allowed to see.
  */
  const href = (() => {
    const q = new URLSearchParams({ print: "1" });
    const org = params.get("org");
    const preview = params.get("preview");
    if (org) q.set("org", org);
    if (preview === "1") q.set("preview", "1");
    return `/benchmarking/worksheet?${q.toString()}`;
  })();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "p" && e.key !== "P") return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      router.push(href);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, href]);

  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 text-sm text-gray-600 underline underline-offset-4 hover:text-[#163D6D] print:hidden"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.8}
          d="M6 9V4h12v5M6 18H5a2 2 0 01-2-2v-5a2 2 0 012-2h14a2 2 0 012 2v5a2 2 0 01-2 2h-1m-12 0v3h12v-3m-12 0h12"
        />
      </svg>
      Print a blank copy to fill in by hand
    </a>
  );
}
