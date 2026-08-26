import { titleCaseProvince, type RepresentationSnapshot } from "@/lib/elections/representation";

/**
 * The nominee pool against the membership it is drawn from.
 *
 * Always shown as a PAIR. A count of nominees means nothing on its own — three
 * colleges is a lot if the membership has four and very little if it has
 * twenty-five. Showing one without the other invites the wrong conclusion.
 *
 * Nothing here scores or ranks a nominee, and there is no "gap" the software
 * asks anyone to close. Unrepresented buckets are stated as observations for a
 * committee that is going to have conversations about them.
 */
export default function RepresentationPanel({
  snapshot,
}: {
  snapshot: RepresentationSnapshot;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">Representation</h2>
        <p className="mt-1 text-xs text-gray-500">
          {snapshot.nomineeCount} nominee{snapshot.nomineeCount === 1 ? "" : "s"} from{" "}
          {snapshot.nomineeOrgCount} institution{snapshot.nomineeOrgCount === 1 ? "" : "s"}, against{" "}
          {snapshot.eligibleOrgCount} eligible member{snapshot.eligibleOrgCount === 1 ? "" : "s"}.
          For information only — nothing here affects who reaches the ballot.
        </p>
      </div>

      <div className="divide-y divide-gray-100">
        {snapshot.dimensions.map((d) => {
          const buckets = [
            ...new Set([...Object.keys(d.membership), ...Object.keys(d.nominees)]),
          ].sort();
          return (
            <div key={d.key} className="px-5 py-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {d.label}
                </h3>
                {d.containsDerivedValues && (
                  <span
                    className="text-[11px] text-amber-700"
                    title="Some institutions have no confirmed value, so a guess derived from the institution's name is being used."
                  >
                    includes derived values
                  </span>
                )}
              </div>

              <table className="mt-2 w-full text-sm">
                <tbody>
                  {buckets.map((bucket) => {
                    const nominees = d.nominees[bucket] ?? 0;
                    const members = d.membership[bucket] ?? 0;
                    const width = members ? Math.round((nominees / members) * 100) : 0;
                    return (
                      <tr key={bucket}>
                        <td className="w-36 py-1 pr-3 text-gray-700">
                          {bucket === "unknown"
                            ? "not recorded"
                            : d.key === "province"
                              ? titleCaseProvince(bucket)
                              : bucket.replace(/_/g, " ")}
                        </td>
                        <td className="py-1 pr-3">
                          <div className="h-1.5 w-full overflow-hidden rounded bg-gray-100">
                            <div
                              className={`h-full rounded ${nominees ? "bg-[#B92026]" : "bg-transparent"}`}
                              style={{ width: `${Math.min(100, width)}%` }}
                            />
                          </div>
                        </td>
                        <td className="w-24 py-1 text-right tabular-nums text-gray-600">
                          {nominees} / {members}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {d.unrepresented.length > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  No nominee from:{" "}
                  <span className="text-gray-700">
                    {d.unrepresented
                      .map((u) =>
                        u === "unknown"
                          ? "not recorded"
                          : d.key === "province"
                            ? titleCaseProvince(u)
                            : u
                      )
                      .join(", ")}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {snapshot.orgsWithMultipleNominees.length > 0 && (
        <div className="border-t border-gray-200 px-5 py-3 text-xs text-gray-600">
          More than one nominee from:{" "}
          {snapshot.orgsWithMultipleNominees
            .map((o) => `${o.name} (${o.count})`)
            .join(", ")}
        </div>
      )}
    </section>
  );
}
