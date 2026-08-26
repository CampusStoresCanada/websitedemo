"use client";

/**
 * The only interactive thing on the worksheet, so it is the only part that
 * needs to be a client component. Everything else renders on the server and
 * prints without JavaScript — which matters, because a printed sheet should not
 * depend on a bundle having loaded.
 */
export default function PrintButton() {
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
