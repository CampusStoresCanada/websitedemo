"use client";

import { formatCalendarDate } from "@/lib/time/supabase-timestamp";
import type { ConferenceAnswer } from "@/lib/conference/agenda";


/** A meal's menu, for "what's for dinner?" at the desk. */
export type WarRoomMenu = { id: string; title: string; dayKey: string; startTime: string | null; menu: string };

/**
 * Answers: what people ask, answered once in Build — the same list each person
 * sees on their own conference page — and tonight's menus.
 */
export function AnswersView({
  conferenceId,
  answers,
  menus,
  canEdit,
}: {
  conferenceId: string;
  answers: ConferenceAnswer[];
  menus: WarRoomMenu[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-white px-[18px] py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15.5px] font-medium text-[#16345a]">Good to know</h2>
          {canEdit ? (
            <a href={`/admin/conference/${conferenceId}/build`} className="text-xs text-accent hover:underline">
              Add or edit in Build (kind: Answer)
            </a>
          ) : null}
        </div>
        {answers.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No answers yet. In Build, add a thing of kind &ldquo;Answer&rdquo; named as the question (Wi-Fi, Coat
            check), with the answer. It shows here and on everyone&apos;s own conference page.
          </p>
        ) : (
          <dl className="mt-2 divide-y divide-gray-100">
            {answers.map((a) => (
              <div key={a.id} className="py-2">
                <dt className="text-sm font-medium text-gray-900">
                  {a.question}
                  {a.where ? <span className="ml-2 font-normal text-gray-500">{a.where}</span> : null}
                </dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm text-gray-700">{a.answer}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-[18px] py-4">
        <h2 className="text-[15.5px] font-medium text-[#16345a]">Menus</h2>
        {menus.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No menus yet. Each meal in Build has a Menu field; it shows beside the meal on people&apos;s schedules.
          </p>
        ) : (
          <dl className="mt-2 divide-y divide-gray-100">
            {menus.map((m) => (
              <div key={m.id} className="py-2">
                <dt className="text-sm font-medium text-gray-900">
                  {m.title}
                  <span className="ml-2 font-normal text-gray-500">
                    {formatCalendarDate(m.dayKey) ?? m.dayKey}
                    {m.startTime ? `, ${m.startTime}` : ""}
                  </span>
                </dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm text-gray-700">{m.menu}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
