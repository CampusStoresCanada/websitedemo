import { redirect } from "next/navigation";

/**
 * Everything this page carried now lives on the org page itself.
 *
 * The to-do list, payment and agreements moved into #conference_checklist,
 * and seat assignment was never needed here at all — the org roster has had a
 * checkbox per conference entity per person the whole time, so this page's
 * "Who's going" panel was a second implementation of it.
 *
 * Kept as a redirect rather than deleted: checklist reminder emails carrying
 * this URL are already in people's inboxes, and the addresses in them have to
 * keep working. The conference id is dropped because the org page resolves
 * the current conference itself.
 */
export default async function OrgConferencePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug } = await params;
  redirect(`/org/${slug}#conference_checklist`);
}
