import Link from "next/link";
import type { ExhibitorStatus } from "@/lib/conference/exhibitor-status";

/**
 * "Exhibitor: Booths 716, 718" — the booth number stated plainly, directly
 * under the org's logo.
 *
 * The matching circular mark lives in the Certifications & Standing row (see
 * exhibitorCertification() in lib/certifications.ts) — the badge is the
 * recognition, this line is the fact. Keeping them apart means the booth
 * number reads at a glance without hunting through badge tooltips.
 */
export default function ExhibitorBoothLine({
  status,
  className = "",
}: {
  status: ExhibitorStatus;
  className?: string;
}) {
  const { boothNumbers } = status;

  return (
    <Link
      href={status.floorPlanHref}
      title={`See this booth on the ${status.conferenceName} floor plan`}
      className={`group inline-flex items-baseline gap-1.5 text-sm ${className}`}
    >
      <span className="font-semibold text-[#16345a]">Exhibitor:</span>
      {boothNumbers.length > 0 ? (
        <span className="font-medium text-[#e72a28] group-hover:underline">
          Booth{boothNumbers.length > 1 ? "s" : ""} {boothNumbers.join(", ")}
        </span>
      ) : (
        <span className="text-gray-500 group-hover:underline">{status.year}</span>
      )}
    </Link>
  );
}
