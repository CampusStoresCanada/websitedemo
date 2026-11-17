/**
 * /admin/board/register — who is on the board, and how that changes.
 *
 * The board register existed as a table with no screen. Every control that
 * wrote to it lived inside an election, so the only way the board could change
 * was the once-a-year path: nominate, elect, certify. A resignation, or the
 * board appointing someone to the seat it left, had nowhere to be recorded —
 * though By-Law Part IV has always allowed both.
 *
 * `asOf` is a query parameter because the useful question is usually about a
 * future date. "What does the board look like on 1 January" is what tells you
 * whether the incoming terms have been recorded yet, and it is the same date
 * the governance mailing list press asks about.
 */

import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import BoardRegisterClient from "@/components/admin/board/BoardRegisterClient";
import { loadBoardRegister } from "@/lib/governance/register";
import { today } from "@/lib/elections/service";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

export const metadata = { title: "Board register | Admin | Campus Stores Canada" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function BoardRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; body?: string }>;
}) {
  // ⛔ A page gates itself. It never inherits authorisation from its layout.
  const auth = await requireAuthenticated();
  if (!auth.ok || !isGlobalAdmin(auth.ctx.globalRole)) notFound();

  const { asOf: asOfParam, body: bodyParam } = await searchParams;
  const asOf = asOfParam && ISO.test(asOfParam) ? asOfParam : today();

  // `governance_bodies` holds four bodies, not one. The board is the default
  // because it is the one with seats, a minimum and an election behind it, but
  // the register is the same question for any of them.
  const register = await loadBoardRegister({
    asOf,
    bodyKey: bodyParam?.trim() || "board_of_directors",
  });
  if (!register) notFound();

  const view = (t: (typeof register.holding)[number]) => ({
    assignmentId: t.assignmentId,
    personContactId: t.personContactId,
    personProfileId: t.personProfileId,
    organizationId: t.organizationId,
    name: t.name,
    organizationName: t.organizationName,
    termStart: t.termStart,
    termEnd: t.termEnd,
    countsTowardCap: t.countsTowardCap,
    accessFrom: t.accessFrom,
    accessUntil: t.accessUntil,
    appointingResolution: t.appointingResolution,
    notes: t.notes,
  });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={register.body.name}
        description={`${register.holding.length} holding a seat as at ${asOf}${
          register.body.seatCount === null ? "" : ` · ${register.body.seatCount} seats`
        }${register.body.minSeatCount === null ? "" : ` · minimum ${register.body.minSeatCount}`}`}
      />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-gray-600">
          Show the board as at
          <input
            type="date"
            name="asOf"
            defaultValue={asOf}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          />
        </label>
        {bodyParam ? <input type="hidden" name="body" value={bodyParam} /> : null}
        <button
          type="submit"
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Show
        </button>
      </form>

      <BoardRegisterClient
        bodyId={register.body.id}
        asOf={asOf}
        holding={register.holding.map(view)}
        incoming={register.incoming.map(view)}
        withAccess={register.withAccessNotHolding.map((w) => ({
          ...view(w.term),
          standing: w.standing as "incoming" | "outgoing",
        }))}
        seatCount={register.body.seatCount}
        minSeatCount={register.body.minSeatCount}
        offices={register.offices.map((o) => ({
          contactId: o.contactId,
          office: o.office,
          heldUntil: o.heldUntil,
        }))}
        nextAgmDate={register.nextAgmDate}
        vacancies={register.vacancies}
        belowMinimum={register.belowMinimum}
        revalidate={`/admin/board/register${bodyParam ? `?body=${encodeURIComponent(bodyParam)}` : ""}`}
      />
    </div>
  );
}
