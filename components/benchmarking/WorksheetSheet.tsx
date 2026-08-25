import type { Worksheet, WorksheetLine } from "@/lib/benchmarking/worksheet";
import PrintButton from "./PrintButton";

/**
 * The worksheet as it prints.
 *
 * Deliberately plain: black on white, no brand colour, no shading behind text.
 * Most of these will come out of a shared office printer that is low on toner,
 * and a sheet whose help text is grey-on-grey is a sheet nobody reads.
 *
 * Everything interactive is `print:hidden`; everything structural survives.
 */

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  // UTC, like the email: a deadline is a calendar date, and rendering it in the
  // server's zone turns "closes November 20" into the 19th for every member.
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function WriteBox({ line }: { line: WorksheetLine }) {
  if (line.type === "boolean") {
    return (
      <span className="inline-flex items-center gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 border border-black" /> Yes
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 border border-black" /> No
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-end gap-1">
      {line.type === "currency" && <span className="text-[11px]">$</span>}
      <span className="inline-block min-w-[92px] flex-1 border-b border-black/70">&nbsp;</span>
      {line.suffix && <span className="text-[11px]">{line.suffix}</span>}
      {line.type === "percentage" && !line.suffix && <span className="text-[11px]">%</span>}
    </span>
  );
}

export default function WorksheetSheet({ worksheet }: { worksheet: Worksheet }) {
  const closes = fmtDate(worksheet.closesAt);
  const cols = worksheet.priorYears.length;

  return (
    <div className="mx-auto max-w-4xl bg-white px-6 py-8 text-black print:max-w-none print:px-0 print:py-0">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>

      <header className="mb-5 border-b-2 border-black pb-3">
        <h1 className="text-xl font-bold leading-tight">
          {worksheet.fiscalYear} CSC Benchmarking Survey — gathering worksheet
        </h1>
        <p className="mt-1 text-sm font-semibold">{worksheet.organizationName}</p>
        <p className="mt-2 max-w-3xl text-[12px] leading-snug">
          Every figure the survey asks for, in the order it asks. Gather these first, then
          the form takes most stores under an hour.
          {closes && <> The survey closes on <strong>{closes}</strong>.</>}
        </p>
        {worksheet.noHistory ? (
          <p className="mt-2 max-w-3xl text-[12px] leading-snug">
            We have no previous submission on file for {worksheet.organizationName}, so there
            is nothing to compare against this year. That is not a problem — it just means
            every figure here is new.
          </p>
        ) : (
          <p className="mt-2 max-w-3xl text-[12px] leading-snug">
            Your own previous answers are printed beside each question. If this year&rsquo;s
            figure is very different, that is worth a note when you file — it saves a
            reviewer phoning you in November to ask.
          </p>
        )}
      </header>

      {worksheet.sections.map((section) => (
        <section key={section.id} className="mb-6 break-inside-avoid">
          <h2 className="mb-2 border-b border-black/60 pb-1 text-sm font-bold uppercase tracking-wide">
            {section.title}
          </h2>
          {section.description && (
            <p className="mb-2 text-[11px] leading-snug">{section.description}</p>
          )}

          {cols > 0 && (
            <div className="mb-1 flex items-end gap-3 text-[10px] font-semibold uppercase">
              <span className="flex-1" />
              {worksheet.priorYears.map((y) => (
                <span key={y} className="w-24 text-right">
                  {y}
                </span>
              ))}
              <span className="w-40">{worksheet.fiscalYear}</span>
            </div>
          )}

          <ul className="space-y-2">
            {section.lines.map((line) => (
              <li
                key={line.name}
                className="break-inside-avoid border-b border-black/15 pb-2"
                style={{ marginLeft: `${line.indent * 14}px` }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-[12px] font-semibold leading-snug">
                      {line.label}
                      {line.required && <span aria-hidden> *</span>}
                    </p>
                    {line.helpText && (
                      <p className="mt-0.5 text-[10.5px] leading-snug">{line.helpText}</p>
                    )}
                    {line.example && (
                      <p className="mt-0.5 text-[10.5px] italic leading-snug">
                        Example: {line.example}
                        {line.exampleCredit && <> — {line.exampleCredit}</>}
                      </p>
                    )}
                    {line.conditionHint && (
                      <p className="mt-0.5 text-[10.5px] leading-snug">{line.conditionHint}</p>
                    )}
                  </div>

                  {line.priorValues.map((v, i) => (
                    <div
                      key={worksheet.priorYears[i]}
                      className="w-24 pt-0.5 text-right text-[11px] tabular-nums"
                    >
                      {v ?? <span aria-label="not answered">—</span>}
                    </div>
                  ))}

                  <div className="w-40 pt-0.5">
                    <WriteBox line={line} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer className="mt-6 border-t border-black/40 pt-3 text-[10.5px] leading-snug">
        <p>
          <strong>* required.</strong> {worksheet.lineCount} figures in total. Totals and
          percentages the survey works out for you are not listed here — enter the parts and
          the form does the arithmetic.
        </p>
        <p className="mt-1">
          Stuck on a figure, or a question that does not fit how your store reports? Reply to
          the invitation email rather than guessing. A guess is a question we have written
          badly, and we would rather fix it.
        </p>
      </footer>
    </div>
  );
}
