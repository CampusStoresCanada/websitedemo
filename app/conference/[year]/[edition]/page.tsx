import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";

export const metadata = { title: "Conference Hub" };

export default async function ConferenceEditionHubPage({
  params,
}: {
  params: Promise<{ year: string; edition: string }>;
}) {
  const { year, edition } = await params;
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const conferenceResult = await getPublicConference(parseInt(year, 10), edition);
  if (!conferenceResult.success || !conferenceResult.data) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-gray-900">Conference not found</h1>
        <p className="mt-2 text-sm text-gray-600">
          The conference you requested is not available.
        </p>
      </main>
    );
  }

  const conference = conferenceResult.data;

  const links = [
    {
      href: `/conference/${year}/${edition}/register`,
      title: "Registration",
      description: "Choose your registration path and submit conference details.",
    },
    {
      href: `/conference/${year}/${edition}/products`,
      title: "Products",
      description: "Browse conference products and add-ons.",
    },
    {
      href: `/conference/${year}/${edition}/schedule`,
      title: "Schedule",
      description: "View your current meeting schedule and swaps.",
    },
    {
      href: `/conference/${year}/${edition}/orders`,
      title: "Orders",
      description: "Review conference order and checkout history.",
    },
  ] as const;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{conference.name}</h1>
        <p className="mt-1 text-sm text-gray-600">
          Conference Hub · {conference.year} · {conference.edition_code}
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300"
          >
            <h2 className="text-base font-semibold text-gray-900">{item.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{item.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
