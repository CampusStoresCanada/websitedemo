import Link from "next/link";
import { loadDirectoryCompleteness } from "@/lib/publication/completeness-loader";
import { PUBLICATION_FIELD_BY_KEY } from "@/lib/publication/completeness";

/**
 * What would print badly, and what to do about each one.
 *
 * The same scores already drive the staff gap report and the listing proof —
 * this is the third consumer of one computation, not a fourth definition of
 * "complete". `fixHint` was written for exactly this: the field list says what
 * is missing, the hint says how to fix it, and both live beside the editor
 * that changes it rather than on a page you have to be told about.
 *
 * Required gaps come first because they are the difference between a listing
 * and a name in a list. Enhanced ones are worth having and never block.
 */
export default async function PrintReadiness({
  orgId,
  listingHref,
}: {
  orgId: string;
  listingHref: string | null;
}) {
  const [completeness] = await loadDirectoryCompleteness({ orgIds: [orgId] });
  if (!completeness || completeness.missing.length === 0) return null;

  const required = completeness.missing.filter(
    (k) => PUBLICATION_FIELD_BY_KEY[k]?.tier === "required"
  );
  const enhanced = completeness.missing.filter(
    (k) => PUBLICATION_FIELD_BY_KEY[k]?.tier === "enhanced"
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">Your printed listing</h3>
        {listingHref && (
          <Link href={listingHref} className="text-sm font-medium text-[#163D6D] hover:underline">
            See how it looks &rarr;
          </Link>
        )}
      </div>

      <p className="mt-0.5 text-sm text-gray-500">
        {required.length > 0
          ? "Without these your entry prints as a name and a booth number."
          : "Your entry will print. These would make it worth reading."}
      </p>

      <ul className="mt-3 space-y-2">
        {[...required, ...enhanced].map((key) => {
          const field = PUBLICATION_FIELD_BY_KEY[key];
          if (!field) return null;
          return (
            <li key={key} className="text-sm">
              <span className="font-medium text-gray-900">{field.label}</span>
              {field.tier === "required" && (
                <span className="ml-2 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                  needed
                </span>
              )}
              {/* The hint IS the instruction — every one of these is changed by
                  clicking Edit on this page, so there is nowhere else to send
                  them. */}
              <span className="block text-gray-600">{field.fixHint}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
