"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptLegalDocument } from "@/lib/actions/conference-legal";
import type { OrgLegalStatus } from "@/lib/conference/org-legal";

/**
 * Agreements, on the page where the checklist asks for them.
 *
 * The task "Accept partner legal agreement" linked to this very page, which
 * had no acceptance on it — a CTA pointing at itself. The real acceptance UI
 * lived only in the per-assignee welcome flow, unreachable from here.
 *
 * Two lists, because two different people owe them. What the admin owes gets
 * buttons; what their staff owe gets a roster. Merging them would imply the
 * admin can clear the lot, and the action layer would refuse — it records
 * against the signed-in user and rejects any other.
 */
export default function OrgAgreements({ status }: { status: OrgLegalStatus }) {
  const { mine, theirsTitles, people } = status;
  if (mine.length === 0 && theirsTitles.length === 0) return null;

  const outstandingMine = mine.filter((d) => !d.acceptedByViewer).length;
  const peopleOutstanding = people.filter((p) => p.outstanding > 0).length;

  return (
    <section id="agreements" className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">Agreements</h2>
        <p className="text-sm text-gray-500">
          {outstandingMine === 0
            ? "Nothing for you to sign"
            : `${outstandingMine} for you to read and accept`}
        </p>
      </div>

      {mine.length > 0 && (
        <div className="mt-3 space-y-2">
          {mine.map((doc) => (
            <DocRow key={doc.versionId} doc={doc} />
          ))}
        </div>
      )}

      {theirsTitles.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-900">
            Everyone attending accepts these themselves
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {theirsTitles.join(" · ")}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            You can&rsquo;t accept these for someone else — each person does it when they
            sign in. Chase anyone still outstanding.
          </p>

          {people.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">
              Nobody is on this conference yet, so there is nothing to chase.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200">
              {people.map((p) => (
                <li key={p.personId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm text-gray-900">{p.name}</span>
                  {!p.hasAccount ? (
                    // No account means no way to accept — chasing them to sign
                    // something they cannot reach would be the wrong nag.
                    <span className="text-xs text-amber-800">
                      Hasn&rsquo;t activated their account yet
                    </span>
                  ) : p.outstanding === 0 ? (
                    <span className="text-xs font-medium text-green-700">All accepted</span>
                  ) : (
                    <span className="text-xs text-gray-600">
                      {p.outstanding} outstanding
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {peopleOutstanding > 0 && (
            <p className="mt-2 text-xs text-gray-500">
              {peopleOutstanding} of {people.length}{" "}
              {peopleOutstanding === 1 ? "person has" : "people have"} something outstanding.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function DocRow({ doc }: { doc: OrgLegalStatus["mine"][number] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Accept unlocks only once the document has actually been scrolled to the
   * end — or, for one short enough to fit without scrolling, once it has been
   * opened. This is an agreement about money and liability; a button that can
   * be clicked without opening the text makes "I have read and accept" false
   * on its face, and the acceptance record is the thing CSC would rely on.
   *
   * Deliberately not a timer. A reader who is fast is still a reader; a timer
   * only teaches people to wait, and then click without reading anyway.
   */
  const [hasRead, setHasRead] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  function onOpen() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    // A short document may never fire a scroll event because there is nothing
    // to scroll. Measured after paint, so it reflects the rendered height.
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (el && el.scrollHeight <= el.clientHeight + 4) setHasRead(true);
    });
  }

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setHasRead(true);
  }

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptLegalDocument(doc.versionId);
      if (result.success) router.refresh();
      else setError(result.error ?? "Could not record that. Please try again.");
    });
  }

  return (
    <div className="rounded-md border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div>
          <p className="text-sm font-medium text-gray-900">{doc.title}</p>
          {doc.acceptBy === "both" && (
            <p className="text-xs text-gray-500">
              You accept this for the company, and everyone attending accepts it too.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpen}
            className="text-xs text-[#163D6D] underline"
          >
            {open ? "Hide" : "Read it"}
          </button>
          {doc.acceptedByViewer ? (
            <span className="text-xs font-medium text-green-700">
              Accepted{doc.acceptedAt ? ` ${new Date(doc.acceptedAt).toLocaleDateString("en-CA")}` : ""}
            </span>
          ) : (
            <button
              type="button"
              onClick={accept}
              disabled={pending || !hasRead}
              title={hasRead ? undefined : "Open it and read to the end first"}
              className="rounded-md bg-[#163D6D] px-3 py-1 text-xs font-semibold text-white hover:bg-[#12325a] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
            >
              {pending ? "Recording…" : "Accept"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div
          ref={bodyRef}
          onScroll={onScroll}
          // Authored by CSC admins in the legal-docs editor, not user input.
          className="prose prose-sm max-h-64 max-w-none overflow-y-auto border-t border-gray-200 px-3 py-3 text-sm text-gray-700"
          dangerouslySetInnerHTML={{ __html: doc.content }}
        />
      )}
      {open && !hasRead && (
        <p className="px-3 pb-2 text-xs text-gray-500">
          Scroll to the end to enable Accept.
        </p>
      )}
      {error && <p className="px-3 pb-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
