import type { Worksheet, WorksheetLine } from "@/lib/benchmarking/worksheet";
import PrintButton from "./PrintButton";
import { formatDeadline } from "@/lib/benchmarking/deadline";

/**
 * The worksheet as it prints.
 *
 * Deliberately plain: black on white, no brand colour, no shading behind text.
 * Most of these will come out of a shared office printer that is low on toner,
 * and a sheet whose help text is grey-on-grey is a sheet nobody reads.
 *
 * Everything interactive is `print:hidden`; everything structural survives.
 */

/** Types whose answer needs the page width rather than a 40mm column. */
const WIDE_ANSWER = new Set(["text", "text_long", "select", "multiselect"]);

/**
 * How much room a question gets to be answered in.
 *
 * A number needs one short rule. A description needs somewhere to write a
 * sentence, and giving it the same 40mm slot as a dollar figure tells the
 * reader their explanation is not really wanted. Options need to be printed,
 * not hinted at — "choose one" is useless on paper if the choices are only on
 * the screen.
 */
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

  // Print the actual choices. Circle one for a single answer, tick boxes when
  // more than one is allowed — the shape of the control tells them which.
  if (line.type === "select" || line.type === "multiselect") {
    const many = line.type === "multiselect";
    return (
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px]">
        {(line.options ?? []).map((opt) => (
          <span key={opt} className="inline-flex items-center gap-1">
            {many ? (
              <span className="inline-block h-2.5 w-2.5 shrink-0 border border-black" />
            ) : (
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black" />
            )}
            {opt}
          </span>
        ))}
        {/*
          These lists are a prompt, not a closed set — every one of them has a
          tail of things stores added themselves. Leaving somewhere to write
          that is the difference between capturing it and losing it.
        */}
        {many && (
          <span className="inline-flex min-w-[160px] flex-1 items-end gap-1">
            <span className="shrink-0">Other:</span>
            <span className="inline-block flex-1 border-b border-black/70">&nbsp;</span>
          </span>
        )}
        {(line.options ?? []).length === 0 && (
          <span className="inline-block min-w-[120px] flex-1 border-b border-black/70">
            &nbsp;
          </span>
        )}
      </span>
    );
  }

  // Free text gets real writing room: three ruled lines, full width.
  if (line.type === "text" || line.type === "text_long") {
    const rules = line.type === "text_long" ? 4 : 3;
    return (
      <span className="block">
        {Array.from({ length: rules }, (_, i) => (
          <span key={i} className="block border-b border-black/50 pt-3.5">
            &nbsp;
          </span>
        ))}
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
  const closes = formatDeadline(worksheet.closesAt);
  const cols = worksheet.priorYears.length;

  return (
    <div className="mx-auto max-w-4xl bg-white px-6 py-8 text-black print:max-w-none print:px-0 print:py-0">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>

      <header className="mb-5 border-b-2 border-black pb-3">
        {/*
          The logo belongs to the DOCUMENT, not to the site chrome around it.
          A printed worksheet wants a letterhead; it does not want a cart icon,
          a notification bell or a hamburger menu, which is what printing the
          navbar gives you. Plain <img> rather than next/image: this has to be
          painted before the print dialog fires, and lazy loading is exactly the
          wrong behaviour for a page whose purpose is to become paper.
        */}
        <img
          src="/logos/csc-logo.svg"
          alt="Campus Stores Canada"
          className="mb-3 h-8 w-auto"
        />
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
                {/*
                  Two shapes of row. A figure answers beside its label in the
                  narrow column, because a figure fits there. Prose and lists
                  answer UNDERNEATH at full width — the prior-year columns stay
                  on the label row either way, so the years still line up down
                  the page.
                */}
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

                  {!WIDE_ANSWER.has(line.type) && (
                    <div className="w-40 pt-0.5">
                      <WriteBox line={line} />
                    </div>
                  )}
                </div>

                {WIDE_ANSWER.has(line.type) && (
                  <div className="mt-1.5 w-full">
                    <WriteBox line={line} />
                  </div>
                )}
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
