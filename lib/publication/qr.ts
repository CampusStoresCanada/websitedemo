/**
 * QR codes for printed listings.
 *
 * The book is a snapshot; the QR is a pointer. That's what keeps a directory
 * worth something after the show — a member picks it up in April, scans a
 * listing, and gets the current catalogue and a contact who still works there,
 * rather than whatever was true the day we went to press.
 *
 * Rendered as inline SVG at build-of-the-page time: no image host, no runtime
 * request, no per-scan cost, and it prints at any size because it's vector.
 * An <img> pointing at a QR service would have been quicker and would break
 * the moment that service moves — on paper that's unfixable.
 */

import QRCode from "qrcode";

/**
 * Error correction level M — recovers ~15% damage.
 *
 * Deliberately not L: printed directories get folded, thumbed and coffee-ringed,
 * and a code that fails after a crease is worse than one that's slightly denser.
 * Not Q or H either — those inflate module count enough to hurt scanning at the
 * small sizes a listing allows.
 */
const ERROR_CORRECTION = "M" as const;

/**
 * Public URL a printed code resolves to.
 *
 * `?s=p` marks it as coming off paper. Four extra characters cost almost
 * nothing in QR density and buy the one number that matters when deciding
 * whether to print again: how many people scanned the book, as opposed to
 * clicking a link someone shared.
 */
export function exhibitorCodeUrl(baseUrl: string, publicCode: string, fromPrint = true): string {
  return `${baseUrl.replace(/\/$/, "")}/e/${publicCode}${fromPrint ? "?s=p" : ""}`;
}

/**
 * Inline SVG for a URL, sized in CSS units by the caller.
 *
 * Returns the bare <svg> with no XML prolog so it can be dropped straight into
 * markup. The quiet zone stays at the spec's 4 modules — trimming it is the
 * classic reason a printed code won't scan.
 */
export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: ERROR_CORRECTION,
    margin: 4,
    // Colour is applied by the caller's CSS via currentColor where possible;
    // black on white is what scanners are calibrated for, so it stays the default.
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/**
 * Attach a QR to every entry that has a code.
 *
 * A separate pass rather than work inside the renderer: generating a QR is
 * async, and PublicationView has to stay synchronous so the same component can
 * be rendered by renderToStaticMarkup for previews and proofs.
 *
 * Entries without a code come back untouched rather than with a placeholder —
 * a QR that resolves to nothing is worse on paper than no QR at all.
 */
export async function attachQrCodes<T extends { publicCode: string | null; qrSvg?: string | null }>(
  entries: T[],
  baseUrl: string
): Promise<T[]> {
  return Promise.all(
    entries.map(async (e) =>
      e.publicCode ? { ...e, qrSvg: await qrSvg(exhibitorCodeUrl(baseUrl, e.publicCode)) } : e
    )
  );
}
