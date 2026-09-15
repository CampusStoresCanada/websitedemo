import Link from "next/link";
import {
  PRESENTATION_LABELS,
  type PresentationLevel,
} from "@/lib/presentation/mode";

/**
 * What an admin console renders instead of itself while presentation mode is on.
 *
 * ⛔ These routes cannot be masked. Everything under /admin and
 * /benchmarking/admin queries through `createAdminClient()` and never calls
 * `getViewerContext()`, so there is no viewerLevel in the path to lower — the
 * submissions list, the drift report and the flag queue would render every
 * filed row in full with presentation mode on and no sign anything was
 * supposed to have happened.
 *
 * So they are shut rather than filtered. A page whose entire purpose is
 * staff-only data has nothing left once the data is withheld, and a blocked
 * page announces itself; a silently-half-masked one does not.
 *
 * Deliberately an interstitial and not a redirect: mid-demo, being bounced
 * somewhere else with no explanation reads as a broken site in front of the
 * room, and the way out needs to be one visible click.
 */
export default function PresentationBlock({
  level,
  area,
}: {
  level: PresentationLevel;
  area: string;
}) {
  return (
    <div className="mx-auto max-w-xl px-6 py-16 text-center">
      <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
        Presentation mode is on
      </div>

      <h1 className="mb-3 text-2xl font-bold text-gray-900">
        {area} is hidden while you are presenting
      </h1>

      <p className="mb-2 text-sm text-gray-600">
        You are currently showing this site as{" "}
        <strong>{PRESENTATION_LABELS[level]}</strong>. This area reads live
        staff data directly and cannot be masked, so it is closed rather than
        filtered — nothing here is safe to put on a screen share.
      </p>

      <p className="mb-8 text-sm text-gray-600">
        Turn presentation mode off to come back in. Your permissions never
        changed.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Back to the site
        </Link>
        <span className="text-xs text-gray-500">
          Or use “Turn off” in the amber bar at the bottom of the screen.
        </span>
      </div>
    </div>
  );
}
