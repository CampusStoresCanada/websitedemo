import type { ServiceDetails } from "@/lib/conference/service-details";
import { formatCalendarDate } from "@/lib/time/supabase-timestamp";

/**
 * What a partner needs to order power at their booth.
 *
 * The form IS the task. Encore's process is: take this PDF, fill it in, email
 * it back. So the download is the biggest thing here and everything else is
 * one line at most.
 *
 * An earlier version explained the process, the extra charges, the derivation
 * of the deadline and what happens after submission — all true, none of it
 * what someone wanting electricity is looking for. That belongs in the PDF,
 * which is where Encore already put it.
 */
export default function ServiceFacts({
  service,
  boothNumbers,
}: {
  service: ServiceDetails;
  boothNumbers: string[];
}) {
  const facts: { label: string; value: string }[] = [];
  if (service.showCode) facts.push({ label: "Show code", value: service.showCode });
  if (boothNumbers.length > 0) {
    facts.push({
      label: boothNumbers.length === 1 ? "Booth" : "Booths",
      value: boothNumbers.join(", "),
    });
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        {service.documents.map((d) => (
          <a
            key={d.href}
            href={d.href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-[#163D6D] px-3 py-2 text-sm font-semibold text-white hover:bg-[#12325a]"
          >
            {d.label}
          </a>
        ))}
        {service.actionUrl && (
          <a
            href={service.actionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-[#163D6D] px-3 py-2 text-sm font-semibold text-white hover:bg-[#12325a]"
          >
            {service.actionLabel ?? `Order from ${service.name}`}
          </a>
        )}
        {service.contactEmail && (
          <span className="text-sm text-gray-600">
            Email it to{" "}
            <a href={`mailto:${service.contactEmail}`} className="font-medium text-[#163D6D] hover:underline">
              {service.contactName ?? service.contactEmail}
            </a>
          </span>
        )}
      </div>

      {service.formMissing && (
        <p className="mt-2 text-sm text-amber-900">
          We don&rsquo;t have their form yet —{" "}
          <a href="mailto:info@campusstorescanada.ca" className="underline">ask us</a> for it.
        </p>
      )}

      {facts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-6">
          {facts.map((f) => (
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
        <ul className="mt-3 space-y-0.5">
          {service.deadlines.map((d) => (
            <li key={`${d.label}-${d.date}`} className="text-sm">
              <span className="font-medium text-gray-900">
                {formatCalendarDate(d.date) ?? d.date}
                {d.time && <span className="font-normal text-gray-700">, {d.time}</span>}
              </span>
              <span className="text-gray-600"> — {d.label}</span>
            </li>
          ))}
        </ul>
      )}

      {service.onsiteSupportPhone && (
        // The one fact that is useless in the PDF, because during the show the
        // PDF is in an inbox and the screen is not turning on.
        <p className="mt-2 text-xs text-gray-500">
          On-site help: <span className="font-semibold text-gray-800">{service.onsiteSupportPhone}</span>
        </p>
      )}
    </div>
  );
}
