import Link from "next/link";
import DisclosureChoice from "@/components/benchmarking/DisclosureChoice";
import {
  surveyScope,
  confidentialityPoints,
  DELIVERABLES,
  WHAT_TO_GATHER,
} from "@/lib/benchmarking/intro-facts";
import type { SurveyFieldConfig } from "@/lib/benchmarking/default-field-config";
import type { DisclosureLevel } from "@/lib/benchmarking/disclosure";

/**
 * The page a store reads before handing over its financials.
 *
 * It exists because the disclosure choice used to sit beside the fields, which
 * meant the decision was made after the effort had started and the explanation
 * had to fit inside a radio label. Consent taken halfway through a form is a
 * checkbox. This is the same choice, asked once the store knows what it is
 * agreeing to and before it has invested anything.
 *
 * It is NOT a gate. The choice stays changeable for the whole cycle — the
 * survey keeps a compact control — because the seal rule depends on a store
 * being able to change its mind while the year is open.
 *
 * Everything factual here is derived: the section and field counts come from
 * the config that renders the form, the minimum group size from the constant
 * that enforces it. Nothing is typed in that could quietly stop being true.
 */

export default function SurveyIntro({
  fiscalYear,
  organizationName,
  fieldConfig,
  benchmarkingId,
  disclosureLevel,
  closesOn,
  chairNote,
  onBeginHref,
}: {
  fiscalYear: number;
  organizationName: string;
  fieldConfig: SurveyFieldConfig;
  benchmarkingId: string;
  disclosureLevel: DisclosureLevel;
  closesOn: string | null;
  /** Editable by the benchmarking committee chair via site_content. */
  chairNote: { title: string | null; body: string | null } | null;
  onBeginHref: string;
}) {
  const scope = surveyScope(fieldConfig);
  const points = confidentialityPoints();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm text-gray-500">{organizationName}</p>
      <h1 className="mt-1 text-3xl font-bold text-gray-900">
        CSC {fiscalYear} Benchmarking Survey
      </h1>
      <p className="mt-3 text-gray-700">
        Every year member stores pool their operating figures so each of you can see
        where you actually stand — not against the sector in general, but against stores
        of your size, your type and your region. It only works if enough of you file, and
        it is only worth filing if you can trust what happens to the numbers afterwards.
        This page is that part.
      </p>

      {/* ── What it involves ─────────────────────────────────────────── */}
      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">What it involves</h2>
        <p className="mt-2 text-sm text-gray-700">
          {scope.sections} sections, {scope.fields} questions, of which about{" "}
          {scope.financialFields} are figures off your year-end statements. Most of it is
          transcription once you have those in front of you — the work is gathering, not
          answering.
        </p>
        <p className="mt-2 text-sm text-gray-700">
          You do not have to finish in one sitting. Answers save as you type, and you can
          leave and come back{closesOn ? ` any time before ${closesOn}` : ""}.
        </p>
        <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">
          What to have to hand
        </h3>
        <ul className="mt-2 space-y-1">
          {WHAT_TO_GATHER.map((g) => (
            <li key={g} className="flex gap-2 text-sm text-gray-700">
              <span aria-hidden className="text-gray-400">•</span>
              <span>{g}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          {/*
            No minute estimate. The 2025 cycle was collected outside this system,
            so we have never measured one, and a number we invented would be the
            first promise this page broke. What we can say is when people filed.
          */}
          We have not timed it. Last year stores filed anywhere from late October to late
          November, most taking more than one sitting.
        </p>
      </section>

      {/* ── Who sees it ──────────────────────────────────────────────── */}
      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">
          Who sees your figures, and how they are protected
        </h2>
        <dl className="mt-3 space-y-4">
          {points.map((p) => (
            <div key={p.heading}>
              <dt className="text-sm font-medium text-gray-900">{p.heading}</dt>
              <dd className="mt-1 text-sm text-gray-700">{p.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-gray-600">
          Inside CSC, your submission is seen by the staff who run the survey and by the
          benchmarking committee reviewing it for errors. It is never shared with vendor
          partners, and it is never published with your store named unless you choose that
          below.
        </p>
      </section>

      {/* ── What you get back ────────────────────────────────────────── */}
      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">What you get back</h2>
        <ul className="mt-3 space-y-4">
          {DELIVERABLES.map((d) => (
            <li key={d.title}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-gray-900">{d.title}</span>
                <span className="text-xs text-gray-500">{d.when}</span>
                {/*
                  Said out loud rather than blurred. A store should be able to
                  tell what it can rely on now from what we have undertaken to
                  build, and CSC should be able to see its own commitments.
                */}
                {!d.built && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                    in development
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-700">{d.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── The committee chair's own words ──────────────────────────── */}
      {chairNote && (chairNote.title || chairNote.body) && (
        <section className="mt-6 rounded-xl border border-[#163D6D]/20 bg-[#163D6D]/[0.03] p-5">
          <h2 className="text-base font-semibold text-gray-900">
            {chairNote.title || "From the benchmarking committee"}
          </h2>
          {chairNote.body && (
            <p className="mt-2 whitespace-pre-line text-sm text-gray-700">{chairNote.body}</p>
          )}
        </section>
      )}

      {/* ── The choice ───────────────────────────────────────────────── */}
      <div className="mt-6">
        <DisclosureChoice benchmarkingId={benchmarkingId} initialLevel={disclosureLevel} />
        <p className="mt-2 text-xs text-gray-500">
          You can change this at any point while this year&apos;s survey is open — it stays
          on your submission as you work.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Link
          href={onBeginHref}
          className="rounded-lg bg-[#163D6D] px-5 py-2.5 text-sm font-medium text-white"
        >
          Start the survey
        </Link>
        <Link href="/benchmarking/worksheet" className="text-sm text-gray-600 underline">
          Print a blank copy to gather on paper first
        </Link>
      </div>
    </div>
  );
}
