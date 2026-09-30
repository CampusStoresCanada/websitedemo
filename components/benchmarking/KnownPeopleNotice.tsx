import type { StoreContact } from "@/lib/actions/benchmarking-respondent";

/**
 * "Here is who we know. If that is wrong, go and fix it before you start."
 *
 * The same note the printed worksheet leads with, for the same reason: this one
 * list fills in who compiled the survey, who buys for each category, and the
 * whole staffing section. Correcting it once on the organisation page saves
 * typing it three times inside the survey, and only saves anything at all if it
 * is read BEFORE the first question rather than discovered at the sixth.
 *
 * ⛔ Names only. No emails, no phone numbers: this is a prompt to check a list,
 * not a place to publish one, and the survey is often open on a shared screen.
 */
export default function KnownPeopleNotice({
  people,
  organizationSlug,
}: {
  people: StoreContact[];
  organizationSlug: string | null;
}) {
  const orgHref = organizationSlug ? `/org/${organizationSlug}` : null;

  return (
    <div className="mb-8 rounded-lg border border-[#163D6D]/25 bg-[#163D6D]/5 p-5">
      <h2 className="text-base font-semibold text-[#163D6D]">
        Before you start: the people we already know
      </h2>

      {people.length > 0 ? (
        <>
          <p className="mt-2 text-sm text-gray-800">
            We have {people.length}{" "}
            {people.length === 1 ? "person" : "people"} on file for your store. If that is
            wrong,{" "}
            {orgHref ? (
              <a
                href={orgHref}
                className="font-medium text-[#163D6D] underline underline-offset-4"
              >
                go to your organisation page
              </a>
            ) : (
              "go to your organisation page"
            )}{" "}
            and fix it there before you begin.
          </p>
          <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm text-gray-700 sm:grid-cols-2">
            {people.map((person) => (
              <li key={person.id}>
                {person.name}
                {person.roleTitle ? (
                  <span className="text-gray-500"> ({person.roleTitle})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-800">
          We have nobody on file for your store.{" "}
          {orgHref ? (
            <a
              href={orgHref}
              className="font-medium text-[#163D6D] underline underline-offset-4"
            >
              Go to your organisation page
            </a>
          ) : (
            "Go to your organisation page"
          )}{" "}
          and add your people before you begin.
        </p>
      )}

      <p className="mt-3 text-sm text-gray-600">
        It makes the rest of this a great deal easier. The same list fills in who compiled
        the survey, who buys for each category, and your staffing section, so correcting it
        once here saves typing it three times later.
      </p>
    </div>
  );
}
