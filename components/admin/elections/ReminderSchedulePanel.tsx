/**
 * The ballot reminder schedule, written as sentences.
 *
 * The renewal series is configured as `[30, 14, 7, 0]`, and the first version of
 * this panel was a table of the same numbers with a date column bolted on. Both
 * are fine for a machine and unreadable as a *decision*: nobody looks at a grid
 * of offsets and thinks "that lands on a Sunday when every campus store is
 * shut."
 *
 * So each reminder is a card that reads as a sentence, above a strip showing
 * where it sits in the voting window. The controls are the same three values
 * they always were — they are just no longer the thing you read first.
 *
 * Working-day adjustments are shown ON the card that moved, not collected in a
 * warnings box at the bottom. The point is to answer "why is this Friday?"
 * exactly where the question occurs.
 */

import type { PlannedReminder, ReminderPlan } from "@/lib/elections/reminders";

function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Date without the weekday, for sentences that already name the day. */
function dateOnly(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  });
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function daysBetween(a: string, b: string): number {
  const p = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(b) - p(a)) / 86_400_000);
}

/** Where the voting window sits, with each reminder marked along it. */
function Timeline({ plan }: { plan: ReminderPlan }) {
  const span = Math.max(1, plan.windowDays);
  return (
    <div className="mt-4">
      <div className="relative h-12">
        <div className="absolute inset-x-0 top-5 h-1 rounded bg-gray-200" />
        {plan.steps
          .filter((s) => !s.problem)
          .map((step) => {
            const offset = Math.min(
              100,
              Math.max(0, (daysBetween(plan.ballotsOpenAt, step.sendOn) / span) * 100)
            );
            return (
              <div
                key={step.label + step.sendOn}
                className="absolute top-0 -translate-x-1/2 text-center"
                style={{ left: `${offset}%` }}
              >
                <span className="block whitespace-nowrap text-[10px] font-medium text-gray-600">
                  {shortDate(step.sendOn)}
                </span>
                <span
                  className={`mx-auto mt-1 block h-3 w-3 rounded-full border-2 border-white ${
                    step.deliberateNonWorkingDay
                      ? "bg-amber-500"
                      : step.movedFrom
                        ? "bg-blue-500"
                        : "bg-gray-800"
                  }`}
                />
              </div>
            );
          })}
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>Voting opens {shortDate(plan.ballotsOpenAt)}</span>
        <span>Closes {shortDate(plan.ballotsCloseAt)}</span>
      </div>
    </div>
  );
}

function StepCard({
  step,
  index,
  windowDays,
  outstandingCount,
}: {
  step: PlannedReminder | null;
  index: number;
  windowDays: number;
  outstandingCount: number | null;
}) {
  const isNew = step === null;

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        step?.problem
          ? "border-red-200 bg-red-50"
          : isNew
            ? "border-dashed border-gray-300 bg-gray-50"
            : "border-gray-200 bg-white"
      }`}
    >
      {isNew ? (
        <p className="text-sm font-medium text-gray-500">Add another reminder</p>
      ) : (
        <>
          <p className="text-sm font-semibold text-gray-900">
            {longDate(step.sendOn)}
          </p>
          <p className="mt-0.5 text-sm text-gray-700">
            <span className="font-medium">{step.label}</span> — {step.describes}
            {step.audience === "not_yet_voted" && outstandingCount !== null && (
              <> ({outstandingCount} today)</>
            )}
          </p>
          {step.movedFrom && step.movedBecause && (
            <p className="mt-1 text-xs text-blue-700">
              Would have been {dateOnly(step.movedFrom)}, {step.movedBecause}. Moved so it lands
              on a working day.
            </p>
          )}
          {step.deliberateNonWorkingDay && (
            <p className="mt-1 text-xs text-amber-700">
              This sends on a day campus stores are closed. Set deliberately — nothing will move
              it.
            </p>
          )}
          {step.problem && <p className="mt-1 text-xs text-red-700">{step.problem}</p>}
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <input
          name="label"
          defaultValue={step?.label ?? ""}
          placeholder="Name this reminder…"
          aria-label={`Reminder ${index + 1} label`}
          className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <input
          name="daysBeforeClose"
          type="number"
          min={0}
          max={windowDays}
          defaultValue={step ? step.daysBeforeClose : ""}
          aria-label={`Reminder ${index + 1} days before close`}
          className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <span>days before close, to</span>
        <select
          name="audience"
          defaultValue={step?.audience ?? "not_yet_voted"}
          aria-label={`Reminder ${index + 1} audience`}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="not_yet_voted">stores that haven&apos;t voted</option>
          <option value="everyone">every eligible store</option>
        </select>
        <span>· if that&apos;s a weekend or holiday,</span>
        <select
          name="onNonWorkingDay"
          defaultValue={step?.onNonWorkingDay ?? "move_earlier"}
          aria-label={`Reminder ${index + 1} non-working day handling`}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="move_earlier">move it earlier</option>
          <option value="move_later">move it later</option>
          <option value="send_anyway">send it anyway</option>
        </select>
      </div>
    </div>
  );
}

export default function ReminderSchedulePanel({
  plan,
  minimumGapDays,
  save,
  error,
  saved,
  outstandingCount,
}: {
  plan: ReminderPlan;
  minimumGapDays: number;
  save: (formData: FormData) => Promise<void>;
  error?: string;
  saved?: boolean;
  outstandingCount: number | null;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">Ballot reminders</h2>
      <p className="mt-1 text-sm text-gray-600">
        Voting is open for {plan.windowDays} days, from {longDate(plan.ballotsOpenAt)} to{" "}
        {longDate(plan.ballotsCloseAt)}. Reminders are counted back from the close, so they move
        with the AGM if its date changes.
      </p>

      <Timeline plan={plan} />

      {error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}
      {saved && (
        <div className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
          Reminder schedule saved.
        </div>
      )}
      {plan.problems.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <p className="font-medium">Nothing will send while these are unresolved:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {plan.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <form action={save} className="mt-4 space-y-3">
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" name="enabled" value="1" defaultChecked={plan.enabled} />
          Send these automatically
        </label>

        <div className="space-y-2">
          {plan.steps.map((step, i) => (
            <StepCard
              key={step.label + step.sendOn}
              step={step}
              index={i}
              windowDays={plan.windowDays}
              outstandingCount={outstandingCount}
            />
          ))}
          <StepCard
            step={null}
            index={plan.steps.length}
            windowDays={plan.windowDays}
            outstandingCount={outstandingCount}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          Leave at least
          <input
            name="minimumGapDays"
            type="number"
            min={0}
            defaultValue={minimumGapDays}
            className="w-16 rounded-md border border-gray-300 px-2 py-1"
          />
          days between reminders
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Save schedule
          </button>
          <span className="text-xs text-gray-500">
            Clear a name to remove that reminder. A schedule that cannot run is refused rather
            than saved.
          </span>
        </div>
      </form>

      <p className="mt-3 text-xs text-gray-500">
        A reminder fires only on the exact day it is due. A missed day is not sent late —
        &ldquo;last chance&rdquo; arriving after the close would be worse than not arriving.
      </p>
    </section>
  );
}
