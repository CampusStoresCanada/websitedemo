import { redirect } from "next/navigation";

/**
 * The old registration form wrote `conference_registrations`, which nothing
 * reads since registrations became seats bought from the conference page's
 * offers (cart, then checkout). It was unlinked but still reachable by address
 * while registration was open (2026-10-26); the address now goes where
 * registering actually happens.
 */
export default async function RegisterPage({ params }: { params: Promise<{ year: string; edition: string }> }) {
  const { year, edition } = await params;
  redirect(`/conference/${year}/${edition}`);
}
