import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { listDirectoryContacts } from "@/lib/contacts/directory";
import { headers } from "next/headers";
import { parseOrgCategories } from "@/lib/publication/categories";
import { recordDirectoryScan } from "@/lib/publication/scan-tracking";

export const dynamic = "force-dynamic";

/**
 * Where a printed QR code lands.
 *
 * The directory is frozen in November; this page is not. Someone scanning a
 * listing in April gets the current catalogue and a contact who still works
 * there — which is the whole reason the book stays worth keeping between
 * editions rather than being a four-day artifact.
 *
 * Public and unauthenticated on purpose. A QR that demands a login is a QR
 * nobody scans twice, and everything here is already on the org's public
 * profile. Deliberately no dependence on the conference: the org outlives the
 * edition, so the code keeps resolving after the show.
 */

type ExhibitorCard = {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  company_description: string | null;
  primary_category: string | null;
  highlight_product_name: string | null;
  highlight_product_description: string | null;
  catalogue_url: string | null;
};

async function loadByCode(code: string) {
  const db = createAdminClient();
  const { data: org } = await db
    .from("organizations")
    .select(
      "id, name, slug, logo_url, company_description, primary_category, highlight_product_name, highlight_product_description, catalogue_url",
    )
    .eq("public_code", code.toUpperCase())
    .is("archived_at", null)
    .maybeSingle();
  if (!org) return null;

  const o = org as unknown as ExhibitorCard;

  const [contacts, { data: balances }] = await Promise.all([
    // This page is public — anyone who scans the printed code lands here — so
    // people who left or asked not to be listed must not appear.
    listDirectoryContacts<{
      name: string | null;
      role_title: string | null;
      work_email: string | null;
      email: string | null;
      work_phone_number: string | null;
      phone: string | null;
    }>({
      organizationIds: [o.id],
      fields: "name, role_title, work_email, email, work_phone_number, phone",
    }),
    db
      .from("entity_balances")
      .select(
        "entity:conference_entities!entity_balances_entity_id_fkey(kind, name, conference_id)",
      )
      .eq("organization_id", o.id),
  ]);

  const people = (contacts ?? [])
    .map((c) => ({
      name: (c.name ?? "").trim(),
      roleTitle: c.role_title?.trim() || null,
      email: c.work_email?.trim() || c.email?.trim() || null,
      phone: c.work_phone_number?.trim() || c.phone?.trim() || null,
    }))
    .filter((c) => c.name && (c.email || c.phone))
    // A stated role tells a reader who they're calling — surface those first.
    .sort(
      (a, b) => Number(Boolean(b.roleTitle)) - Number(Boolean(a.roleTitle)),
    );

  const booths = (balances ?? [])
    .map((r) => (Array.isArray(r.entity) ? r.entity[0] : r.entity))
    .filter(
      (e): e is { kind: string; name: string; conference_id: string } =>
        e?.kind === "booth",
    )
    .map((e) => e.name);

  return { org: o, people, booths: [...new Set(booths)] };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const found = await loadByCode(code);
  return found
    ? {
        title: found.org.name,
        description: found.org.company_description ?? undefined,
      }
    : { title: "Not found" };
}

export default async function ExhibitorCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { code } = await params;
  const found = await loadByCode(code);
  if (!found) notFound();

  const { org, people, booths } = found;

  // The printed QR encodes ?s=p, so a real scan off paper is distinguishable
  // from someone following a shared link — which is the actual question when
  // judging whether the print run earned its place. Awaited rather than
  // fire-and-forget: this runs during render, and a floating promise in a
  // serverless function can be killed before it lands. recordDirectoryScan
  // never throws, so the page renders regardless.
  const { s } = await searchParams;
  await recordDirectoryScan({
    organizationId: org.id,
    publicCode: code.toUpperCase(),
    userAgent: (await headers()).get("user-agent"),
    source: s === "p" ? "print" : "link",
  });
  const cats = parseOrgCategories(org.primary_category);

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-start gap-4">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logo_url}
              alt=""
              className="h-16 w-16 flex-none object-contain"
            />
          ) : null}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{org.name}</h1>
            {booths.length > 0 ? (
              <p className="mt-0.5 text-sm font-semibold text-[#163D6D]">
                Booth{booths.length > 1 ? "s" : ""} {booths.join(", ")} · CSC
                2027
              </p>
            ) : null}
            {cats.departments.length > 0 ? (
              <p className="mt-1 text-xs text-gray-500">
                {cats.departments.join(" · ")}
              </p>
            ) : null}
          </div>
        </div>

        {org.company_description ? (
          <p className="mt-4 text-sm leading-relaxed text-gray-700">
            {org.company_description}
          </p>
        ) : null}

        {org.highlight_product_name ? (
          <div className="mt-4 rounded-lg bg-gray-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Featured
            </p>
            <p className="mt-0.5 text-sm font-semibold text-gray-900">
              {org.highlight_product_name}
            </p>
            {org.highlight_product_description ? (
              <p className="mt-0.5 text-sm text-gray-600">
                {org.highlight_product_description}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          {org.catalogue_url ? (
            <a
              href={org.catalogue_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-[#163D6D] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Browse catalogue
            </a>
          ) : null}
          {org.slug ? (
            <Link
              href={`/org/${org.slug}`}
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700"
            >
              Full profile
            </Link>
          ) : null}
        </div>
      </div>

      {people.length > 0 ? (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">
            Who to talk to
          </h2>
          <ul className="mt-3 space-y-3">
            {people.slice(0, 4).map((p) => (
              <li
                key={`${p.name}-${p.email ?? p.phone}`}
                className="border-t border-gray-100 pt-3 first:border-0 first:pt-0"
              >
                <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                {p.roleTitle ? (
                  <p className="text-xs text-gray-500">{p.roleTitle}</p>
                ) : null}
                {/* tel: and mailto: rather than copyable text — the point of
                    scanning a printed page is that the phone does the next step. */}
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {p.phone ? (
                    <a
                      href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700"
                    >
                      Call {p.phone}
                    </a>
                  ) : null}
                  {p.email ? (
                    <a
                      href={`mailto:${p.email}`}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700"
                    >
                      Email
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-4 text-center text-xs text-gray-400">
        Campus Stores Canada member directory
      </p>
    </main>
  );
}
