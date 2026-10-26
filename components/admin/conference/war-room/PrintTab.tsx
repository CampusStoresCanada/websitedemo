"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCalendarDate } from "@/lib/time/supabase-timestamp";
import { advanceBadgePrintJob, createPreprintedBadgeJob, deleteBadgePrintJob, loadPrintOverview, loadReprintPreview, type PrintOverview, type ReprintPreview } from "@/lib/actions/conference-badges";
import { printBadge } from "@/lib/actions/conference-people";
import { updateField } from "@/lib/actions/update-field";
import { cardChoices, type BadgeStock } from "@/lib/conference/badges/reprint-plan";
import ConfirmAction from "@/components/ui/ConfirmAction";
import Modal from "@/components/ui/Modal";
import OperateRow from "@/components/ui/OperateRow";

import { whenMountain, type ConferencePerson } from "./shared";

/** The print station, as the page already read it for the status line. */
export type PrintStationState = { stations: number; online: boolean; queued: number };

const JOB_STATUS_WORDS: Record<string, string> = {
  queued: "Being made",
  rendering: "Being made",
  rendered: "Being made",
  pdf_generated: "File ready",
  sent_to_printer: "At the print station",
  printed: "Printed",
  delivered: "Delivered",
  failed: "Failed",
  canceled: "Cancelled",
};

/**
 * Print (WAR_ROOM_OPERATE_PLAN §5): everything CSC produces on paper, as rows.
 * Badge Ops keeps the design; making the package happens here. A one-off badge
 * goes through the one print engine (printBadge), the desk's own.
 */
export function PrintView({
  conferenceId,
  people,
  station,
}: {
  conferenceId: string;
  people: ConferencePerson[];
  station: PrintStationState;
}) {
  const [overview, setOverview] = useState<PrintOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeBlanks, setIncludeBlanks] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [doorEntity, setDoorEntity] = useState("");

  const apply = (res: Awaited<ReturnType<typeof loadPrintOverview>>) => {
    if (res.success) {
      setOverview(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
  };
  const load = async () => apply(await loadPrintOverview(conferenceId));

  // Jobs move while you watch (a sticker leaving the station), so the list
  // refreshes while the tab is open.
  useEffect(() => {
    let live = true;
    const tick = () =>
      void loadPrintOverview(conferenceId).then((res) => {
        if (!live) return;
        if (res.success) {
          setOverview(res.data);
          setError(null);
        } else {
          setError(res.error);
        }
      });
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [conferenceId]);

  const base = `/admin/conference/${conferenceId}`;
  const sheet = (path: string) => `${base}${path}${path.includes("?") ? "&" : "?"}embed=1`;

  if (!overview) {
    return (
      <p className={`text-sm ${error ? "text-red-700" : "text-gray-500"}`}>{error ?? "Loading what there is to print…"}</p>
    );
  }

  const pkg = overview.latestPackage;
  const blocked = overview.blockingCount > 0;
  const packageState = blocked
    ? `${overview.blockingCount} problem${overview.blockingCount === 1 ? "" : "s"} stop it: ${overview.blocking[0]}`
    : pkg
      ? `Last made ${whenMountain(pkg.createdAt)}, template v${pkg.templateVersion ?? "?"}, ${
          pkg.includeBlanks ? "with blanks" : "named only"
        }. ${overview.named} named now.`
      : `Not made yet. ${overview.named} named badge${overview.named === 1 ? "" : "s"} to print.`;

  return (
    <div className="space-y-5">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Badges</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="Badge package"
            state={packageState}
            tone={blocked ? "blocked" : pkg ? "neutral" : "attention"}
            edit={{ href: `${base}/badges?mode=studio`, label: "Edit design" }}
            preview={{
              title: "Badge package",
              content: (
                <div className="space-y-4 text-sm text-gray-700">
                  <p>
                    {overview.template
                      ? `Template v${overview.template.version} (${overview.template.name}, ${overview.template.status}).`
                      : "No badge template yet: design one in Badge Ops."}{" "}
                    {overview.named} named badge{overview.named === 1 ? "" : "s"}, front and back, in the order set in
                    Badge Ops.
                  </p>
                  {overview.blocking.length > 0 ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="font-medium text-red-800">What stops it</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-red-800">
                        {overview.blocking.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                      {overview.blockingCount > overview.blocking.length ? (
                        <p className="mt-1 text-xs text-red-700">
                          …and {overview.blockingCount - overview.blocking.length} more. Fix them in Badge Ops.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {overview.textWarnings > 0 ? (
                    <p className="text-amber-800">
                      {overview.textWarnings} name{overview.textWarnings === 1 ? "" : "s"} may not fit the badge. Check
                      them in the studio before the final print.
                    </p>
                  ) : null}
                  {overview.unnamed > 0 ? (
                    <div>
                      <p className="font-medium text-gray-900">
                        {overview.unnamed} seat{overview.unnamed === 1 ? " has" : "s have"} nobody named
                      </p>
                      <p className="text-xs text-gray-500">
                        These companies still owe names. With blanks, each gets a card with the company printed and
                        the person left for the desk to fill in.
                      </p>
                      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
                        {overview.unnamedByOrg.map((org) => (
                          <li key={org.name} className="flex items-baseline justify-between gap-3 text-xs">
                            <span className="truncate">{org.name}</span>
                            <span className="shrink-0 text-gray-500">{org.types}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {pkg?.artifactUrl ? (
                    <a
                      href={pkg.artifactUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Open the last package ↗
                    </a>
                  ) : null}
                </div>
              ),
            }}
            action={
              blocked || !overview.template
                ? null
                : {
                    label: pkg ? "Make it again" : "Make it",
                    consequence: `Builds the print file with template v${overview.template.version}: ${overview.named} named badge${
                      overview.named === 1 ? "" : "s"
                    }${includeBlanks && overview.unnamed > 0 ? ` and ${overview.unnamed} blank${overview.unnamed === 1 ? "" : "s"}` : ""}. Earlier packages stay in the list below.`,
                    onConfirm: async () => {
                      const res = await createPreprintedBadgeJob({
                        conferenceId,
                        templateVersion: overview.template!.version,
                        includeBlanks,
                      });
                      await load();
                      return res.success ? { success: true } : { success: false, error: res.error ?? "It could not be made." };
                    },
                  }
            }
            extra={
              overview.unnamed > 0 && !blocked ? (
                <label className="flex items-center gap-1.5 py-1.5 text-xs text-gray-700">
                  <input type="checkbox" checked={includeBlanks} onChange={(e) => setIncludeBlanks(e.target.checked)} />
                  With {overview.unnamed} blank{overview.unnamed === 1 ? "" : "s"}
                </label>
              ) : null
            }
          />
          <OperateRow
            title="Reprint one badge"
            state="Find the person, check their name, say which card is in hand. A sticker goes to the print station."
            extra={
              <button
                type="button"
                onClick={() => setReprintOpen(true)}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
              >
                Reprint…
              </button>
            }
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-4">
        <h3 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Sheets</h3>
        <div className="divide-y divide-gray-100">
          <OperateRow
            title="Check-in cards"
            state="The cards on each booth table that confirm a meeting happened."
            preview={{ title: "Check-in cards", src: sheet("/check-in/cards"), printable: true }}
          />
          <OperateRow
            title="Attendee list"
            state="Everyone attending, in your name order."
            preview={{ title: "Attendee list", src: sheet("/check-in/door-list"), printable: true }}
          />
          {overview.doorEvents.length > 0 ? (
            <OperateRow
              title="Door list"
              state={doorEntity ? "Who has a ticket for this event, for the person at the door." : "Pick the event."}
              preview={
                doorEntity
                  ? {
                      title: "Door list",
                      src: sheet(`/check-in/door-list?entity=${doorEntity}`),
                      printable: true,
                    }
                  : null
              }
              extra={
                <select
                  value={doorEntity}
                  onChange={(e) => setDoorEntity(e.target.value)}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                  aria-label="Event"
                >
                  <option value="">Event…</option>
                  {overview.doorEvents.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name} · {formatCalendarDate(event.date)}
                    </option>
                  ))}
                </select>
              }
            />
          ) : null}
          <OperateRow
            title="Individual schedules"
            state="One page per person: their meetings, rooms and times."
            edit={{ href: `${base}/schedule`, label: "Meetings" }}
            preview={{ title: "Individual schedules", src: sheet("/check-in/schedules?view=people"), printable: true }}
          />
          <OperateRow
            title="Suite door sheets"
            state="For each suite door: who meets there, and when."
            preview={{ title: "Suite door sheets", src: sheet("/check-in/schedules?view=suites"), printable: true }}
          />
          <OperateRow
            title="Map"
            state="The floor plan on one page."
            edit={{ href: `${base}/floor-plan`, label: "Floor plan" }}
            preview={{ title: "Map", src: sheet("/directory?sheet=map"), printable: true }}
          />
          <OperateRow
            title="Directory"
            state="The printed directory, as the book is set."
            edit={{ href: `${base}/directory` }}
            preview={{ title: "Directory", src: sheet("/directory"), printable: true }}
          />
          <OperateRow
            title="Bursary meeting proof"
            state="Each bursary institution's meetings, and which the check-in cards confirmed."
            preview={{ title: "Bursary meeting proof", src: sheet("/bursary-proof"), printable: true }}
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-4 pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Print queue</h3>
          <a href={`${base}/check-in/print-station`} className="text-xs font-medium text-gray-600 hover:text-gray-900">
            {station.stations === 0
              ? "Set up a print station ▸"
              : `${station.online ? "Station online" : "Station offline"}${station.queued ? ` · ${station.queued} waiting` : ""} ▸`}
          </a>
        </div>
        {overview.jobs.length === 0 ? (
          <p className="py-3 text-sm text-gray-500">Nothing printed yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {overview.jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">
                    {job.pipeline === "preprinted"
                      ? `Badge package v${job.templateVersion ?? "?"}, ${job.includeBlanks ? "with blanks" : "named only"}`
                      : `Reprint: ${job.personName ?? "—"}`}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    {whenMountain(job.createdAt)} · {JOB_STATUS_WORDS[job.status] ?? job.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {job.artifactUrl ? (
                    <a
                      href={job.artifactUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Open ↗
                    </a>
                  ) : null}
                  {job.pipeline === "preprinted" && job.status === "pdf_generated" ? (
                    <ConfirmAction
                      label="Delivered"
                      consequence="Records that the printer has delivered this package."
                      size="sm"
                      onConfirm={async () => {
                        const res = await advanceBadgePrintJob({ jobId: job.id, nextStatus: "delivered" });
                        await load();
                        return res;
                      }}
                    />
                  ) : null}
                  {job.status === "sent_to_printer" ? (
                    <ConfirmAction
                      label="Cancel"
                      consequence="Takes it off the print station's queue. It will not print."
                      size="sm"
                      tone="danger"
                      onConfirm={async () => {
                        const res = await advanceBadgePrintJob({ jobId: job.id, nextStatus: "canceled" });
                        await load();
                        return res;
                      }}
                    />
                  ) : null}
                  {job.status !== "rendering" ? (
                    <ConfirmAction
                      label="Delete"
                      consequence="Removes this job and its history for good."
                      size="sm"
                      tone="danger"
                      onConfirm={async () => {
                        const res = await deleteBadgePrintJob({ conferenceId, jobId: job.id, reason: "Deleted in the War Room" });
                        await load();
                        return res;
                      }}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {reprintOpen ? (
        <ReprintModal
          conferenceId={conferenceId}
          people={people}
          person={null}
          onClose={() => {
            setReprintOpen(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Reprint one badge from the War Room: the desk's reprint, without the camera
 * (Stephen, 2026-10-23). What will print, correctable in place (updateField, as
 * at the desk); which card is in hand (cardChoices, the desk's choices); then
 * the one print engine.
 */
export function ReprintModal({
  conferenceId,
  people,
  person,
  onClose,
}: {
  conferenceId: string;
  people: ConferencePerson[];
  /** Who, when the caller already knows; otherwise the modal asks. */
  person: { id: string; name: string | null } | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<{ id: string; name: string | null } | null>(person);
  const [draft, setDraft] = useState<{ preview: ReprintPreview; first: string; last: string; title: string } | null>(null);
  const [stock, setStock] = useState<BadgeStock>("none");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; artifactUrl: string | null } | null>(null);

  // The callers mount this only while it is open (keyed by person), so state
  // starts fresh for each reprint.
  const loadFor = useCallback(
    (personId: string) =>
      loadReprintPreview({ conferenceId, personId, includeCards: true }).then((res) => {
        if (!res.success) {
          setLoadError(res.error);
          return;
        }
        setDraft({ preview: res.data, first: res.data.firstName, last: res.data.lastName, title: res.data.roleTitle });
        setStock(res.data.suggestedStock ?? "none");
      }),
    [conferenceId]
  );
  useEffect(() => {
    if (person) void loadFor(person.id);
  }, [person, loadFor]);

  const choose = (next: { id: string; name: string | null }) => {
    setChosen(next);
    void loadFor(next.id);
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people
      .filter((p) => `${p.display_name ?? ""} ${p.contact_email ?? ""}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [people, query]);

  const close = onClose;

  const changes = draft
    ? (
        [
          ["first_name", draft.first.trim(), draft.preview.firstName],
          ["last_name", draft.last.trim(), draft.preview.lastName],
          ["role_title", draft.title.trim(), draft.preview.roleTitle],
        ] as const
      ).filter(([, next, before]) => next !== before.trim())
    : [];
  const choices = cardChoices(draft?.preview.cards ?? null);
  const stockLabel = choices.find(([value]) => value === stock)?.[1] ?? "No card";
  const field = "w-full rounded bg-transparent px-1 text-center text-black focus:bg-amber-50 focus:outline-none";

  return (
    <Modal
      open
      onClose={close}
      title={chosen ? `Reprint: ${chosen.name ?? "badge"}` : "Reprint one badge"}
      footer={
        draft && !done ? (
          <ConfirmAction
            label="Print badge"
            consequence={[
              changes.length > 0 ? "Saves the corrected name to their record." : null,
              stock === "none"
                ? "Makes the full colour badge as a file for a colour printer: the label printer can't print it."
                : `Prints a sticker for the ${stockLabel.toLowerCase()} at the print station.`,
            ]
              .filter(Boolean)
              .join(" ")}
            onConfirm={async () => {
              for (const [column, next] of changes) {
                const saved = await updateField({
                  table: "contacts",
                  column,
                  entityId: draft.preview.contactId!,
                  newValue: next || null,
                });
                if (!saved.success) return { success: false, error: saved.error ?? "The name could not be saved." };
              }
              const res = await printBadge({
                conferenceId,
                personId: chosen!.id,
                // As at the desk: an edit IS the reason; otherwise it is not asked.
                reason: changes.length > 0 ? "name_change" : "ops_override",
                note: changes.length > 0 ? null : "Reprint from the War Room",
                stockInHand: stock,
              });
              if (!res.success) return res;
              const printed = res.data;
              setDone({
                text: !printed.labelPrintable
                  ? "The full colour badge is ready to print."
                  : printed.queueError
                    ? `Planned, but the print station refused it: ${printed.queueError}`
                    : printed.stationOnline
                      ? "Sent to the print station."
                      : "Sent, but the print station is offline. Start CSC Print Station on the laptop by the printer.",
                artifactUrl: printed.artifactUrl,
              });
              return { success: true };
            }}
          />
        ) : undefined
      }
    >
      <div className="space-y-4 p-5 text-sm">
        {!chosen ? (
          <div>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email"
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
            <ul className="mt-2 divide-y divide-gray-100">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => choose({ id: p.id, name: p.display_name })}
                    className="w-full px-1 py-2 text-left hover:bg-gray-50"
                  >
                    <span className="font-medium text-gray-900">{p.display_name ?? "Unnamed"}</span>
                    {p.contact_email ? <span className="ml-2 text-xs text-gray-500">{p.contact_email}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : loadError ? (
          <p className="text-red-700">{loadError}</p>
        ) : !draft ? (
          <p className="text-gray-500">Loading their badge…</p>
        ) : done ? (
          <div className="space-y-2">
            <p className="font-medium text-gray-900">{done.text}</p>
            {done.artifactUrl ? (
              <a
                href={done.artifactUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Open the badge ↗
              </a>
            ) : null}
          </div>
        ) : (
          <>
            {/* What prints, as it prints. Click a line to correct it. */}
            <div className="mx-auto max-w-xs rounded-lg border border-gray-300 bg-white p-4 text-center shadow-sm">
              {(["first", "last", "title"] as const).map((key) => (
                <input
                  key={key}
                  aria-label={key === "first" ? "First name" : key === "last" ? "Last name" : "Title"}
                  value={draft[key]}
                  disabled={!draft.preview.contactId}
                  placeholder={key === "title" ? "No title" : undefined}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className={`${field} ${key === "first" ? "text-2xl font-bold uppercase" : key === "last" ? "text-lg" : "text-sm"}`}
                />
              ))}
              {draft.preview.organizationName ? (
                <p className="mt-1 text-sm font-semibold">{draft.preview.organizationName}</p>
              ) : null}
            </div>
            <p className="text-center text-xs text-gray-500">
              {draft.preview.contactId
                ? "Click a line to correct it. A correction saves to their record."
                : "This badge has no contact record to correct."}
            </p>
            <fieldset>
              <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Which card is in hand?</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {choices.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStock(value)}
                    aria-pressed={stock === value}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                      stock === value ? "border-accent bg-red-50 text-accent" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {stock === "none" ? (
                <p className="mt-1 text-xs text-amber-800">No card: the label printer can&apos;t print a full badge.</p>
              ) : null}
            </fieldset>
          </>
        )}
      </div>
    </Modal>
  );
}
