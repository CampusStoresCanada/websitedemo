/**
 * What their badge will actually say.
 *
 * "Check your details are right" asks someone to audit a record they cannot
 * see, in a format they have to imagine. Showing the badge turns that into a
 * glance: a misspelling, a stale job title or the wrong organisation is
 * obvious at a look and nearly invisible in a form.
 *
 * Deliberately not pixel-exact to the printed stock — a rough likeness that is
 * honest about being a preview beats a facsimile that implies a precision the
 * print template may not match. What matters is that the WORDS are the words.
 */
export default function BadgePreview({
  name,
  title,
  organisation,
}: {
  name: string | null;
  title: string | null;
  organisation: string | null;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        Your badge
      </p>
      <div className="mt-2 rounded-md border border-gray-300 bg-white px-4 py-5 text-center shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#163D6D]">
          Campus Stores Conference
        </p>
        <p className="mt-3 text-xl font-bold leading-tight text-gray-900 [font-family:var(--font-primary)]">
          {name?.trim() || (
            // Never render an empty badge as if it were fine.
            <span className="text-amber-700">Your name is missing</span>
          )}
        </p>
        {title?.trim() && <p className="mt-1 text-sm text-gray-600">{title}</p>}
        <p className="mt-1 text-sm font-medium text-gray-800">
          {organisation?.trim() || <span className="text-amber-700">No organisation</span>}
        </p>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Printed from your contact details. Anything wrong here is wrong on the badge —
        fix it in Details, above.
      </p>
    </div>
  );
}
