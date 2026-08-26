import Link from "next/link";
import { formatMetric, type ComparisonCut } from "@/lib/benchmarking/comparison";
import { attributionNotice } from "@/lib/benchmarking/canary";

/**
 * How a store reads against its peers.
 *
 * Two rules in the presentation, both of which follow from the suppression
 * rules rather than decorating them:
 *
 *   A withheld cut says why. A blank panel reads as a broken report and teaches
 *   people the tool does not work; the reason teaches them it is careful.
 *
 *   There is no league table. Standing is above / at / below the median, never
 *   a rank, because a rank is a name in disguise — "you are 4th of 7" plus two
 *   named peers is arithmetic on the other five.
 */

function Standing({ standing }: { standing: "above" | "below" | "at" | null }) {
  if (!standing) return null;
  const copy =
    standing === "above"
      ? "above the middle"
      : standing === "below"
        ? "below the middle"
        : "at the middle";
  return <span className="text-xs text-gray-500">{copy}</span>;
}

export default function ComparisonView({
  organizationName,
  fiscalYear,
  cuts,
  youFiled,
}: {
  organizationName: string;
  fiscalYear: number | null;
  cuts: ComparisonCut[];
  youFiled: boolean;
}) {
  if (!fiscalYear) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-2xl font-bold text-gray-900">How you compare</h1>
        <p className="mt-2 text-gray-600">
          Nobody has filed a survey yet, so there is nothing to compare against.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">How you compare</h1>
      <p className="mt-1 text-sm text-gray-600">
        {organizationName} · FY{fiscalYear}
      </p>

      {!youFiled && (
        <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          You did not file in FY{fiscalYear}, so there is nothing of yours to place against
          these figures. You can still see how the group looks.{" "}
          <Link href="/benchmarking" className="font-medium underline">
            Take part this year
          </Link>{" "}
          and this page fills in.
        </p>
      )}

      <p className="mt-4 max-w-2xl text-sm text-gray-600">
        Every figure here comes from stores that agreed to share it. Stores that asked not
        to be named still count toward the middle — they are in the numbers, just not in
        the list.
      </p>

      {/*
        Said plainly and up front, not in a footer. This is the half of the attribution-mark rule that
        actually prevents leaks: a member deciding whether to forward this should
        know it is traceable BEFORE they do it, and should equally know their own
        numbers are untouched so they never wonder whether we altered their data.
      */}
      <p className="mt-3 max-w-2xl rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
        {attributionNotice(organizationName)}
      </p>

      <div className="mt-8 space-y-8">
        {cuts.map((cut) => (
          <section key={cut.key} className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">{cut.label}</h2>
              <span className="text-xs text-gray-500">
                {cut.bucket} · {cut.cutSize} store{cut.cutSize === 1 ? "" : "s"}
              </span>
            </div>

            {!cut.showAggregate ? (
              <p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                {cut.suppressionReason}
              </p>
            ) : (
              <>
                <table className="mt-4 w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                      <th className="pb-2 font-medium">Measure</th>
                      <th className="pb-2 text-right font-medium">You</th>
                      <th className="pb-2 text-right font-medium">Middle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cut.metrics.map((m) => (
                      <tr key={m.key} className="border-b border-gray-100 last:border-b-0">
                        <td className="py-2 pr-3">
                          <span className="text-gray-900">{m.label}</span>
                          {m.hint && (
                            <span className="block text-xs text-gray-500">{m.hint}</span>
                          )}
                          {m.n < cut.cutSize && (
                            <span className="block text-xs text-gray-400">
                              {m.n} of {cut.cutSize} stores reported this
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums text-gray-900">
                          {formatMetric(m.yours, m.format)}
                          <span className="block">
                            <Standing standing={m.standing} />
                          </span>
                        </td>
                        <td className="py-2 text-right tabular-nums text-gray-600">
                          {formatMetric(m.median, m.format)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {cut.suppressionReason && (
                  <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                    {cut.suppressionReason}
                  </p>
                )}

                {cut.withheldForReciprocity > 0 && (
                  <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                    {cut.withheldForReciprocity} store
                    {cut.withheldForReciprocity === 1 ? "" : "s"} in this group agreed to be
                    named. You are not seeing them because your own store is set to
                    aggregate-only — named detail works both ways. You can change that on
                    your submission at any time.
                  </p>
                )}

                {cut.named.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-xs font-medium uppercase text-gray-500">
                      Stores happy to be named
                    </h3>
                    <table className="mt-2 w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                          <th className="pb-1 font-medium">Store</th>
                          {cut.metrics.map((m) => (
                            <th key={m.key} className="pb-1 text-right font-medium">
                              {m.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cut.named.map((p) => (
                          <tr
                            key={p.organizationId}
                            className="border-b border-gray-100 last:border-b-0"
                          >
                            <td className="py-1.5 pr-3 text-gray-900">
                              {p.organizationName}
                            </td>
                            {cut.metrics.map((m) => (
                              <td
                                key={m.key}
                                className="py-1.5 text-right tabular-nums text-gray-700"
                              >
                                {formatMetric(p.values[m.key] ?? null, m.format)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
