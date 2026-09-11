"use client";

/**
 * Find the person you want to nominate, without reloading the page.
 *
 * It used to be a plain GET form. Every search was therefore a full render of
 * the nomination page — and that render resolves eligibility, which loads every
 * organization and upserts a verdict row for all of them. Searching for a
 * colleague rewrote the membership's eligibility table.
 *
 * The form element is deliberately still here. Submitting it navigates to ?q=,
 * which the server still answers, so the page keeps working with JavaScript
 * off, Enter still does the obvious thing, and a ?q= link is still shareable.
 * What JavaScript adds is that you rarely need it: typing fetches from a small
 * endpoint that only runs the contact query.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export interface NomineeResult {
  contactId: string;
  name: string;
  roleTitle: string | null;
  organizationName: string;
}

export default function NomineeSearch({
  slug,
  initialQuery,
  initialResults,
  previewing,
}: {
  slug: string;
  initialQuery: string;
  /** Rendered by the server for ?q= links and for no-JS. */
  initialResults: NomineeResult[];
  previewing: boolean;
}) {
  // Built here, not passed in: a function cannot cross the server/client
  // boundary as a prop, and passing one blanked the whole page.
  const chooseHref = (contactId: string) =>
    `/elections/${slug}/nominate?nominee=${contactId}${previewing ? "&preview=1" : ""}`;
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<NomineeResult[]>(initialResults);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  // Whether the user has typed since load. Until they do, the server's results
  // stand — otherwise a ?q= link would blank itself out on arrival.
  const touched = useRef(false);

  useEffect(() => {
    if (!touched.current) return;
    const term = query.trim();

    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      setFailed(false);
      return;
    }

    setSearching(true);
    const controller = new AbortController();
    // Long enough that ordinary typing is one request, short enough to feel
    // immediate. Every earlier request is aborted, so results cannot arrive out
    // of order and overwrite a newer search.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/elections/${slug}/nominatable?q=${encodeURIComponent(term)}`,
          { signal: controller.signal, credentials: "include" }
        );
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results?: NomineeResult[] };
        setResults(body.results ?? []);
        setFailed(false);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Fall back to the form rather than pretending there is nobody: an
        // empty list and a failed request look identical and mean opposite
        // things.
        setFailed(true);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, slug]);

  return (
    <>
      <form method="get" className="mt-6 flex gap-2">
        {previewing && <input type="hidden" name="preview" value="1" />}
        <input
          type="search"
          name="q"
          value={query}
          onChange={(e) => {
            touched.current = true;
            setQuery(e.target.value);
          }}
          placeholder="Search by name"
          aria-label="Search for someone to nominate"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-[#2B2E33] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a1d21]"
        >
          Search
        </button>
      </form>

      <div aria-live="polite" className="min-h-[1.25rem]">
        {searching && <p className="mt-2 text-xs text-gray-500">Searching…</p>}
        {failed && (
          <p className="mt-2 text-xs text-amber-700">
            Could not search just now — press Search to try the full page.
          </p>
        )}
        {!searching && !failed && touched.current && query.trim().length >= 2 && results.length === 0 && (
          <p className="mt-2 text-xs text-gray-500">
            Nobody at a member institution matches “{query.trim()}”.
          </p>
        )}
      </div>

      {results.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
          {results.map((r) => (
            <li key={r.contactId}>
              <Link
                href={chooseHref(r.contactId)}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-gray-50"
              >
                <span>
                  <span className="font-medium text-gray-900">{r.name}</span>
                  {r.roleTitle && <span className="text-gray-500"> · {r.roleTitle}</span>}
                  <span className="block text-xs text-gray-500">{r.organizationName}</span>
                </span>
                <span className="text-xs text-gray-400">Choose</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
