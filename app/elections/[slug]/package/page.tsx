/**
 * /elections/[slug]/package — the members' AGM package.
 *
 * Assembled at read time rather than mailed as a file. The financial statements
 * are private and must not become a public URL; the nominating report and the
 * candidate statements are generated from live data and would go stale the
 * moment somebody withdrew; and a page can be revisited on the day of the
 * meeting, which an attachment buried in December's inbox cannot.
 *
 * Eligibility to read it is the same test as eligibility to vote, and a store
 * that fails it is told why rather than shown an empty page — "why can't I see
 * the financials" has a real answer, and it is usually "renew".
 */

import Link from "next/link";
import { getServerAuthState } from "@/lib/auth/server";
import { getMemberAgmPackage } from "@/lib/elections/service";
import { ElectionShell, Notice, SignInPrompt } from "@/components/elections/ElectionShell";

export const dynamic = "force-dynamic";

function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-gray-200 pt-5">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-gray-500">{note}</p>}
      <div className="mt-2 text-sm text-gray-700">{children}</div>
    </section>
  );
}

/** Content authored by CSC staff in the admin editor, not by members. */
function Authored({ html }: { html: string }) {
  return (
    <div
      className="prose prose-sm max-w-none prose-headings:font-semibold"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default async function AgmPackagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const auth = await getServerAuthState();
  if (!auth.user)
    return (
      <SignInPrompt returnTo={`/elections/${slug}/package`} action="read your AGM package" />
    );

  const pkg = await getMemberAgmPackage(slug, auth.user.id, auth.organizations);
  if (!pkg) {
    return (
      <ElectionShell eyebrow="Campus Stores Canada · Elections" title="Not found">
        <p className="text-sm text-gray-600">That meeting doesn&apos;t exist.</p>
      </ElectionShell>
    );
  }

  const { election } = pkg;
  const eyebrow = `Campus Stores Canada · ${election.cycleYear} Annual General Meeting`;

  if (pkg.blocked) {
    return (
      <ElectionShell eyebrow={eyebrow} title="Your AGM package">
        <Notice tone="warning">{pkg.blocked}</Notice>
      </ElectionShell>
    );
  }

  return (
    <ElectionShell eyebrow={eyebrow} title="Your AGM package">
      <p className="text-sm text-gray-700">
        The {election.cycleYear} annual general meeting is on{" "}
        <strong>{longDate(election.schedule.agmDate)}</strong>. Everything below is the material
        for that meeting
        {pkg.organizationName ? `, for ${pkg.organizationName}` : ""}. This page stays here — you
        can come back to it during the meeting.
      </p>

      <div className="mt-6 space-y-6">
        <Section
          title="Notice of the meeting"
          note="By-Law Part VII S4(b)"
        >
          {pkg.noticeSentAt ? (
            <p>
              Notice was given on {longDate(pkg.noticeSentAt)}, more than 21 days before the
              meeting as the by-laws require.
            </p>
          ) : (
            <p className="text-gray-500">Notice has not been issued yet.</p>
          )}
        </Section>

        <Section title="Agenda">
          {pkg.agendaHtml ? (
            <Authored html={pkg.agendaHtml} />
          ) : (
            <p className="text-gray-500">The agenda has not been published yet.</p>
          )}
        </Section>

        {pkg.priorAgmDate && (
          <Section
            title={`Minutes of the ${longDate(pkg.priorAgmDate)} meeting`}
            note="The meeting will be asked to approve these"
          >
            {pkg.priorMinutesHtml ? (
              <Authored html={pkg.priorMinutesHtml} />
            ) : (
              <p className="text-gray-500">Not yet published.</p>
            )}
          </Section>
        )}

        <Section
          title="Reviewed financial statements"
          note="The meeting will be asked to receive and approve these"
        >
          {pkg.financials ? (
            <a
              href={pkg.financials.url}
              className="inline-block rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-900 hover:bg-gray-50"
            >
              Open {pkg.financials.filename}
            </a>
          ) : (
            <p className="text-gray-500">
              Not yet available — the statements are with the association&apos;s public
              accountant. They will appear here when the review is complete.
            </p>
          )}
        </Section>

        <Section title="Report of the nominating committee" note="By-Law Part V">
          {pkg.report ? (
            // The generator already produces the report's own HTML; rebuilding
            // it from sections here would be a second renderer to keep in step.
            <Authored html={pkg.report.html} />
          ) : (
            <p className="text-gray-500">
              Nominations are still open. The committee reports once they close.
            </p>
          )}
        </Section>

        {pkg.candidates.length > 0 && (
          <Section title="The candidates" note="In the order they appear on the ballot">
            <div className="space-y-4">
              {pkg.candidates.map((c) => (
                <div key={c.nominationId}>
                  <p className="font-medium text-gray-900">
                    {c.displayName}{" "}
                    <span className="font-normal text-gray-600">· {c.organizationName}</span>
                  </p>
                  {c.bio && <p className="mt-0.5 whitespace-pre-line text-gray-700">{c.bio}</p>}
                  {c.platform && (
                    <p className="mt-1 whitespace-pre-line text-gray-700">{c.platform}</p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section
          title="If you cannot attend"
          note="By-Law Part VII S7 — one proxy per member store"
        >
          <p>
            You can appoint someone to attend and vote on your store&apos;s behalf. It takes a
            minute and can be changed any time before the meeting starts.
          </p>
          <Link
            href={pkg.proxyUrl}
            className="mt-3 inline-block rounded-lg bg-[#B92026] px-5 py-2.5 font-medium text-white hover:bg-[#9c1b20]"
          >
            Appoint a proxy
          </Link>
        </Section>
      </div>
    </ElectionShell>
  );
}
