/**
 * Moving board access when the board changes over.
 *
 * ⛔ Shows the NAMES before anything moves. These are live administrator
 * accounts, and the failure this guards against is somebody losing a login
 * they still need — which nobody notices until they try to use it.
 *
 * Two buttons, not one. The incoming join at the meeting; the outgoing keep
 * theirs through the conference afterwards. Each side carries its own date.
 */

import type { BoardTransitionPlan, TransitionPerson } from "@/lib/elections/transition";

function People({ people, empty }: { people: TransitionPerson[]; empty: string }) {
  if (people.length === 0) return <p className="mt-1 text-xs text-gray-500">{empty}</p>;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-gray-700">
      {people.map((p) => (
        <li key={p.contactId}>
          {p.name}
          <span className="text-gray-500"> · {p.organizationName}</span>
          {p.protectedRole && (
            <span className="text-gray-500"> · administrator for another reason, left alone</span>
          )}
          {!p.protectedRole && p.alreadyHasAccess && (
            <span className="text-gray-500"> · already an administrator</span>
          )}
          {!p.profileId && (
            <span className="text-amber-700"> · no account yet, must sign in once first</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function DatePicker({ side, agmDate, conferenceEndsOn }: {
  side: "incoming" | "outgoing";
  agmDate: string;
  conferenceEndsOn: string | null;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <select
        name="dateChoice"
        defaultValue={side === "incoming" ? "agm" : "after_conference"}
        aria-label={`When the ${side} change takes effect`}
        className="rounded border border-gray-300 px-2 py-1"
      >
        <option value="agm">At the meeting ({agmDate})</option>
        <option value="after_conference">
          {conferenceEndsOn
            ? `End of the next conference (${conferenceEndsOn})`
            : "End of the next conference (none on record)"}
        </option>
        <option value="custom">A date I choose</option>
      </select>
      <input
        type="date"
        name="customDate"
        aria-label="Custom effective date"
        className="rounded border border-gray-300 px-2 py-1"
      />
    </div>
  );
}

export default function BoardTransitionPanel({
  plan,
  agmDate,
  conferenceEndsOn,
  certified,
  apply,
}: {
  plan: BoardTransitionPlan;
  agmDate: string;
  conferenceEndsOn: string | null;
  certified: boolean;
  apply: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-gray-900">Board access</h2>
      <p className="mt-1 text-sm text-gray-600">
        Who gains the console and who loses it. The two sides happen months apart, so each is
        pressed separately and each carries its own date.
      </p>

      {!certified ? (
        <p className="mt-3 text-sm text-amber-700">
          The result is not certified, so nobody has been elected yet and there is nothing to move.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium text-gray-900">Joining</p>
              <People people={plan.incoming} empty="Nobody new." />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-900">Leaving</p>
              <People people={plan.outgoing} empty="Nobody leaving." />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-900">Continuing</p>
              {/* Re-elected incumbents. Listed so six names do not imply six
                  changes — their access does not move at all. */}
              <People people={plan.continuing} empty="None." />
            </div>
          </div>

          {plan.incoming.length > 0 && (
            <form action={apply} className="mt-5 border-t border-gray-100 pt-4">
              <input type="hidden" name="side" value="incoming" />
              <p className="text-xs font-medium text-gray-900">
                Give the incoming directors access
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Records the term and makes them administrators. Circle adds reconcile on their own
                from the space rules.
              </p>
              <DatePicker side="incoming" agmDate={agmDate} conferenceEndsOn={conferenceEndsOn} />
              <button
                type="submit"
                className="mt-2 rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Grant access to {plan.incoming.length} director
                {plan.incoming.length === 1 ? "" : "s"}
              </button>
            </form>
          )}

          {plan.outgoing.length > 0 && (
            <form action={apply} className="mt-5 border-t border-gray-100 pt-4">
              <input type="hidden" name="side" value="outgoing" />
              <p className="text-xs font-medium text-gray-900">
                Remove the outgoing directors&apos; access
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Takes the console away and raises a dated obligation on the board&apos;s list to
                remove them from the Circle spaces and revoke moderator status — that part is by
                hand, because a Circle revoke that fails does not heal itself.
              </p>
              <DatePicker side="outgoing" agmDate={agmDate} conferenceEndsOn={conferenceEndsOn} />
              <button
                type="submit"
                className="mt-2 rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Remove access from {plan.outgoing.length} director
                {plan.outgoing.length === 1 ? "" : "s"}
              </button>
            </form>
          )}

          {plan.noop && (
            <p className="mt-4 text-xs text-gray-500">
              Nobody&apos;s access would change. Everyone elected already has it, and nobody is
              losing it.
            </p>
          )}
        </>
      )}
    </section>
  );
}
