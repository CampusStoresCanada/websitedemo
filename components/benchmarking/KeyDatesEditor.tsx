"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  addKeyDate,
  updateKeyDate,
  removeKeyDate,
  type KeyDate,
} from "@/lib/actions/benchmarking-profile";
import {
  KEY_DATE_KINDS,
  isLegacyKeyDate,
  type KeyDateKind,
  type KeyDateYear,
} from "@/lib/benchmarking/key-dates";

/**
 * Best guess at what kind of date a profile entry is, from its own title.
 *
 * Only ever decides which heading it files under; the store can change it. A
 * wrong guess costs a dropdown, and refusing to guess costs them a decision on
 * every row.
 */
function guessKind(title: string): KeyDateKind {
  const t = title.toLowerCase();
  if (t.includes("adoption")) return "adoption_deadline";
  if (t.includes("buyback") || t.includes("buy back")) return "buyback";
  if (t.includes("add") && t.includes("drop")) return "add_drop";
  if (t.includes("return")) return "returns_cutoff";
  if (t.includes("inventory") || t.includes("count")) return "inventory_count";
  if (t.includes("semester") || t.includes("term")) return "semester";
  return "other";
}

/** How many count dates an inventory style implies, or null if it implies none. */
function countsExpected(style: string | null): number | null {
  if (!style) return null;
  const s = style.toLowerCase();
  if (s.startsWith("annual")) return 1;
  if (s.startsWith("bi-annual")) return 2;
  // Cycle counts run continuously and have no date to name.
  return null;
}

/**
 * The dates the year turns on, for the year BEING REPORTED.
 *
 * ⛔ This used to ask for the year AHEAD, and said so in three places. Karin
 * Stonehouse flagged it on 2026-11-10 asking the obvious question the copy
 * could not answer: "dates that have yet to happen, or dates from the fiscal
 * year that the survey is for?" The group settled it as the reported year, for
 * all six kinds.
 *
 * She was not splitting hairs. Of the ten stores that had entered semester
 * dates, five entered the year being reported and five entered the year ahead,
 * so the column was already carrying both and nothing recorded which. Her own
 * store is in the first group, which is how she came to ask.
 *
 * Every other answer in this survey is historical. A date column that ran the
 * other way could not be read beside the figures it was supposed to explain.
 *
 * Saved against the ORGANISATION, so it is confirmed rather than retyped next
 * year, and other parts of the site can read it.
 */
export default function KeyDatesEditor({
  benchmarkingId,
  /*
    ⛔ Held by the form, not here — this section unmounts when the store leaves
    it. See the note on the state in BenchmarkingSurveyForm.
  */
  dates,
  /**
   * Every key date the store holds, both blocks.
   *
   * Only for deduping the profile suggestions, which are a fact about the
   * organisation rather than about one year. Rendering uses `dates`.
   */
  allDates,
  onDatesChange: setDates,
  /** The year being reported, because this question has to name it. */
  fiscalYear,
  variant,
  isReadOnly,
  isSemesterBased,
  inventoryCountStyle,
  profileSuggestions,
}: {
  benchmarkingId: string;
  dates: KeyDate[];
  allDates: KeyDate[];
  onDatesChange: Dispatch<SetStateAction<KeyDate[]>>;
  fiscalYear: number;
  /**
   * Which block this is.
   *
   * ⛔ Two shapes of one control, not two editors. The rows, the kinds, the
   * actions and the save path are identical; only the heading and whether the
   * prompts run differ. A second component would be two places to fix the next
   * time a kind is added.
   */
  variant: KeyDateYear;
  isReadOnly: boolean;
  /** Semesters are only worth asking for where the year has them. */
  isSemesterBased: boolean;
  /**
   * How the store said it counts stock, two questions up.
   *
   * Answering "bi-annual" and then never being asked WHEN is the gap this
   * closes: the style on its own tells a reader nothing they can plan around,
   * and the store has the dates in front of it at exactly this moment.
   */
  inventoryCountStyle: string | null;
  /**
   * Dates we already hold for this organisation, from its procurement profile.
   *
   * Offered, not adopted. They came from a different conversation and may be
   * stale; only the store knows. Asking a store to retype dates we are already
   * holding is the thing worth avoiding, not the click to confirm them.
   */
  profileSuggestions: { title: string; date: string }[];
}) {
  const [error, setError] = useState<string | null>(null);

  /*
    The year a row added HERE belongs to. Derived, not a prop: the block's
    identity already says it, and two ways to express the same thing is how
    the "ahead" block would one day start writing the reported year.
  */
  const isAhead = variant === "ahead";
  const academicYear = isAhead ? fiscalYear + 1 : fiscalYear;

  /*
    ⛔ The prompts and the count seeding run on the REPORTED block only.

    Both of them add rows on the store's behalf. Rendered in both blocks they
    would each fire once per block, so a bi-annual counter would silently get
    four inventory count rows instead of two, half of them filed against a year
    nobody asked about yet.
  */
  const promptsApply = !isAhead;

  const kinds = KEY_DATE_KINDS.filter(
    (k) => k.value !== "semester" || isSemesterBased,
  );

  const have = (kind: KeyDateKind) => dates.some((d) => d.kind === kind);

  /*
    What their own answers imply we should have, and do not.

    Only ever a prompt — nothing here blocks the section. A store that counts
    stock continuously has no count date to give, and a store that cannot put
    its hands on last year's calendar should not be stuck on this screen for it.
  */
  const expectedCounts = countsExpected(inventoryCountStyle);
  const countDates = dates.filter((d) => d.kind === "inventory_count").length;
  const prompts: { kind: KeyDateKind; label: string; why: string }[] = [];

  if (promptsApply && isSemesterBased && !have("semester")) {
    prompts.push({
      kind: "semester",
      label: "Semester",
      why: `You told us your year runs in semesters. Add each one that ran in FY${fiscalYear}, with its first and last day.`,
    });
  }

  /*
    An annual or bi-annual count means one or two dated rows, so put them there
    rather than asking the store to click a button to be asked a question. The
    row arrives empty and waits for its date; nothing is invented.

    Guarded by a ref because this runs on render and the rows arrive through a
    reload: without it, a slow round trip would add the same row twice.
  */
  const seeding = useRef(false);
  useEffect(() => {
    if (!promptsApply || isReadOnly || seeding.current) return;
    if (expectedCounts === null || countDates >= expectedCounts) return;
    seeding.current = true;
    const wanted = expectedCounts - countDates;
    void (async () => {
      let latest: KeyDate[] | undefined;
      for (let i = 0; i < wanted; i += 1) {
        const res = await addKeyDate({
          benchmarkingId,
          kind: "inventory_count",
          label:
            expectedCounts === 2
              ? `Inventory count ${countDates + i + 1} of 2`
              : "Inventory count",
          academicYear,
        });
        if (res.dates) latest = res.dates;
      }
      // ⛔ Never a page reload. Saves here are debounced by 800ms, so reloading
      // to reveal a date we added for them can discard what they just typed.
      if (latest) setDates(latest);
    })();
  }, [
    benchmarkingId,
    isReadOnly,
    expectedCounts,
    countDates,
    setDates,
    promptsApply,
    academicYear,
  ]);

  /*
    Semester rows held by a store that has since said it does not run semesters.
    Shown rather than deleted: the store entered them, and quietly removing a
    person's own answer because a different answer changed is not ours to do.
  */
  const orphanedSemesters = !isSemesterBased && have("semester");

  /** Rows in this block that we placed by rule rather than by the store saying. */
  const legacyCount = dates.filter((d) => isLegacyKeyDate(d.academicYear)).length;

  /*
    Which suggestions are still worth offering.

    ⛔ Read off the dates themselves, never a list of "taken in this sitting".
    The server recomputes this on a page load and this screen does not reload,
    so a tally kept beside the list went back to empty the moment the store
    left §1 and returned, putting an adopted suggestion back on offer with a
    button that makes a duplicate.

    Keyed `label|date`, which is the rule loadProfileKeyDateSuggestions applies
    server-side — so the two agree, including that editing an adopted date
    offers the original again.
  */
  /*
    ⛔ Built from EVERY date the store holds, not this block's.

    `dates` is one block's worth since the split, and the server rule above
    keys on the whole table. Deduping against the filtered list put a
    suggestion back on offer the moment its adopted row sat in the other block
    — which is every row entered before the question named a year, so it would
    have hit exactly the stores that had already done the work.
  */
  const taken = new Set(allDates.map((d) => `${d.label}|${d.occursOn ?? ""}`));
  const pendingSuggestions = promptsApply
    ? profileSuggestions.filter((s) => !taken.has(`${s.title}|${s.date}`))
    : [];

  const patch = (id: string, fn: (d: KeyDate) => KeyDate) =>
    setDates((prev) => prev.map((d) => (d.id === id ? fn(d) : d)));

  async function add(kind: KeyDateKind, label: string) {
    const res = await addKeyDate({ benchmarkingId, kind, label, academicYear });
    if (!res.success || !res.id) {
      setError(res.error ?? "Could not add that date.");
      return;
    }
    setDates((prev) => [
      ...prev,
      { id: res.id!, kind, label, occursOn: null, endsOn: null, academicYear },
    ]);
  }

  /** Move a row the store entered before we asked, once they tell us which. */
  async function assignYear(id: string, year: number) {
    patch(id, (d) => ({ ...d, academicYear: year }));
    const res = await updateKeyDate({
      benchmarkingId,
      keyDateId: id,
      academicYear: year,
    });
    if (!res.success) setError(res.error ?? "Could not move that date.");
  }

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-gray-900">
        {isAhead ? `And the year ahead, FY${academicYear}` : `Your key dates in FY${fiscalYear}`}
      </h3>
      <p className="mt-1 text-xs text-gray-600">
        {isAhead ? (
          <>
            The same dates for the year coming up, as far as you have them. This part is
            not about your figures. It is so CSC knows when your rush is before it plans
            around it, and so next year you are confirming these rather than typing them
            again. Leave it empty if your calendar is not set.
          </>
        ) : (
          <>
            The dates the year you are reporting turned on, not the year coming up.
            Semester start and end, stock counts, adoption deadlines, buyback windows,
            returns cutoffs and add/drop. They sit beside your figures so a reader can
            tell when your year actually ran.
          </>
        )}
      </p>

      {prompts.length > 0 && !isReadOnly && (
        <div className="mt-3 rounded-lg border-l-4 border-[#163D6D] bg-[#163D6D]/5 p-3">
          <p className="text-xs font-semibold text-[#163D6D]">
            Your answers above suggest we are missing something
          </p>
          <ul className="mt-2 space-y-2">
            {prompts.map((p) => (
              <li key={p.kind} className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-700">{p.why}</span>
                <button
                  onClick={() => void add(p.kind, p.label)}
                  className="rounded-full border border-[#163D6D] px-2.5 py-0.5 text-xs font-medium text-[#163D6D]"
                >
                  + Add {p.label.toLowerCase()}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendingSuggestions.length > 0 && !isReadOnly && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-700">
            We already have these on your profile
          </p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            From your procurement details, so they may be out of date. Add the ones that
            still hold and ignore the rest.
          </p>
          <ul className="mt-2 space-y-1.5">
            {pendingSuggestions.map((sug) => (
              <li key={`${sug.title}|${sug.date}`} className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-700">
                  {sug.title} · {sug.date}
                </span>
                <button
                  onClick={async () => {
                    const res = await addKeyDate({
                      benchmarkingId,
                      kind: guessKind(sug.title),
                      label: sug.title,
                      occursOn: sug.date,
                      academicYear,
                    });
                    if (res.dates) {
                      setDates(res.dates);
                    } else if (res.error) {
                      setError(res.error);
                    }
                  }}
                  className="rounded-full border border-gray-400 px-2.5 py-0.5 text-xs font-medium text-gray-700 hover:border-[#163D6D] hover:text-[#163D6D]"
                >
                  Add it
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {orphanedSemesters && (
        <p className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-900">
          You have semester dates below, but you told us your year does not run in
          semesters. We have left them alone rather than deleting your own entries —
          remove any that no longer apply, or change that answer above.
        </p>
      )}

      {/*
        Rows entered before the question named a year.

        They land here because the question asked for the year ahead at the
        time, so that is what a store filling it in was answering. Said once
        above the list rather than on every row, with the correction offered
        per row underneath.
      */}
      {isAhead && legacyCount > 0 && (
        <p className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-900">
          {legacyCount === 1 ? (
            <>
              One of these was entered when this question asked for the year ahead
              without saying so, so we have put it here. If it is an FY{fiscalYear} date
              instead, move it with the button on the row and it will sit beside your
              figures where it belongs.
            </>
          ) : (
            <>
              {legacyCount === dates.length ? "These" : `${legacyCount} of these`} were
              entered when this question asked for the year ahead without saying so, so we
              have put them here. If any of them are dates from FY{fiscalYear} instead,
              move them with the button on the row and they will sit beside your figures
              where they belong.
            </>
          )}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {dates.map((d) => {
          const kind = KEY_DATE_KINDS.find((k) => k.value === d.kind);
          return (
            <div key={d.id} data-flaggable className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem] flex-1">
                  <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    {kind?.label ?? d.kind}
                  </label>
                  <input
                    type="text"
                    value={d.label}
                    disabled={isReadOnly}
                    onChange={(e) => patch(d.id, (x) => ({ ...x, label: e.target.value }))}
                    onBlur={(e) =>
                      void updateKeyDate({
                        benchmarkingId,
                        keyDateId: d.id,
                        label: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-600">
                    {kind?.hasEnd ? "Starts" : "Date"}
                  </label>
                  <input
                    type="date"
                    value={d.occursOn ?? ""}
                    disabled={isReadOnly}
                    onChange={(e) => {
                      patch(d.id, (x) => ({ ...x, occursOn: e.target.value || null }));
                      void updateKeyDate({
                        benchmarkingId,
                        keyDateId: d.id,
                        occursOn: e.target.value || null,
                      });
                    }}
                    className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>

                {kind?.hasEnd && (
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600">
                      Ends
                    </label>
                    <input
                      type="date"
                      value={d.endsOn ?? ""}
                      disabled={isReadOnly}
                      onChange={(e) => {
                        patch(d.id, (x) => ({ ...x, endsOn: e.target.value || null }));
                        void updateKeyDate({
                          benchmarkingId,
                          keyDateId: d.id,
                          endsOn: e.target.value || null,
                        });
                      }}
                      className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                )}

                {/*
                  The correction, offered only on a row we placed by rule
                  rather than by the store's own answer. Once they click it the
                  row carries a year they declared, and it stops being a guess.
                */}
                {!isReadOnly && isAhead && isLegacyKeyDate(d.academicYear) && (
                  <button
                    onClick={() => void assignYear(d.id, fiscalYear)}
                    className="pb-1.5 text-xs text-[#163D6D] underline hover:text-[#0f2a4c]"
                  >
                    This is an FY{fiscalYear} date
                  </button>
                )}

                {!isReadOnly && (
                  <button
                    onClick={async () => {
                      const res = await removeKeyDate({ benchmarkingId, keyDateId: d.id });
                      if (res.success) setDates((p) => p.filter((x) => x.id !== d.id));
                    }}
                    className="pb-1.5 text-xs text-gray-500 underline hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!isReadOnly && (
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-700">Add a date</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {kinds.map((k) => (
              <button
                key={k.value}
                title={k.help}
                onClick={() => void add(k.value, k.label)}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:border-[#163D6D] hover:text-[#163D6D]"
              >
                + {k.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            Add as many of each as you need — one adoption deadline per term, every
            buyback window, each semester.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
