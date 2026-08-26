import type { ServiceDetails } from "@/lib/conference/service-details";
import { formatCalendarDate } from "@/lib/time/supabase-timestamp";

/**
 * What you need in front of you to place a supplier order.
 *
 * Deliberately not prose. The show code has to be typed into Stronco's site
 * and the booth number written on a shipping label, so both are set large
 * enough to read off the screen while looking somewhere else. The deadlines
 * are a list because there are four of them and only one costs money.
 */
export default function ServiceFacts({
  service,
  boothNumbers,
}: {
  service: ServiceDetails;
  boothNumbers: string[];
}) {
  const bigFacts: { label: string; value: string }[] = [];
  if (service.showCode) bigFacts.push({ label: "Show code", value: service.showCode });
  if (boothNumbers.length > 0) {
    bigFacts.push({
      label: boothNumbers.length === 1 ? "Your booth" : "Your booths",
      value: boothNumbers.join(", "),
    });
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      {bigFacts.length > 0 && (
        <div className="flex flex-wrap gap-6">
          {bigFacts.map((f) => (
            <div key={f.label}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                {f.label}
              </p>
              <p className="text-2xl font-bold tabular-nums tracking-tight text-gray-900">
                {f.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {service.deadlines.length > 0 && (
        <ul className={`${bigFacts.length > 0 ? "mt-3 " : ""}space-y-1`}>
          {service.deadlines.map((d) => (
            <li key={`${d.label}-${d.date}`} className="text-sm">
              <span className="font-medium text-gray-900">
                {formatCalendarDate(d.date) ?? d.date}
              </span>
              <span className="text-gray-600"> — {d.label}</span>
              {d.consequence && (
                <span className="block text-xs text-amber-800">{d.consequence}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {service.formMissing && (
        // Named, not hidden. An exhibitor told to "complete their order form"
        // with no form attached needs to know the gap is ours, not theirs.
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          We don&rsquo;t have {service.name}&rsquo;s order form on file yet. Email{" "}
          <a href="mailto:info@campusstorescanada.ca" className="underline">
            info@campusstorescanada.ca
          </a>{" "}
          and we&rsquo;ll send it — don&rsquo;t go hunting for it.
        </p>
      )}

      {service.documents.length > 0 && (
        <ul className="mt-3 space-y-1">
          {service.documents.map((d) => (
            <li key={d.url}>
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-[#163D6D] hover:underline"
              >
                {d.label} &darr;
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {service.actionUrl && (
          <a
            href={service.actionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-[#163D6D] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#12325a]"
          >
            {service.actionLabel ?? `Open ${service.name}`}
          </a>
        )}
        {service.contactEmail && (
          <a
            href={`mailto:${service.contactEmail}`}
            className="text-xs font-medium text-[#163D6D] hover:underline"
          >
            Send it to {service.contactName ?? service.contactEmail}
          </a>
        )}
      </div>
    </div>
  );
}
