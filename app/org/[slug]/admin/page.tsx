import { redirect } from "next/navigation";
import { resolveOrgSlug } from "@/lib/org/resolve";
import { notFound } from "next/navigation";

interface OrgAdminPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * The org admin dashboard has been retired. Org management now lives on the
 * org profile page (/org/[slug]) via the Toolkit edit mode. Redirect there.
 * Sub-pages (/admin/users, /admin/transfer) remain accessible via the Toolkit.
 */
export default async function OrgAdminPage({ params }: OrgAdminPageProps) {
  const { slug } = await params;
  const org = await resolveOrgSlug(slug);
  if (!org) notFound();
  redirect(`/org/${slug}`);
}
