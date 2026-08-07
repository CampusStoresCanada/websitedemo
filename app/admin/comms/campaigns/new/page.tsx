import Link from "next/link";
import { redirect } from "next/navigation";
import { createCampaignInitiative } from "@/lib/comms/campaigns";

export const metadata = {
  title: "New Campaign | Communications | Admin | Campus Stores Canada",
};

async function handleCreate(formData: FormData) {
  "use server";

  const name = (formData.get("name") as string)?.trim();
  const goal = (formData.get("goal") as string)?.trim() || undefined;
  if (!name) return;

  const result = await createCampaignInitiative({ name, goal });
  if (!result.success || !result.id) return;

  redirect(`/admin/comms/campaigns/${result.id}`);
}

export default function NewCampaignInitiativePage() {
  return (
    <main>
      <Link href="/admin/comms" className="text-sm text-gray-500 hover:text-gray-700">
        ← Communications
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">New Campaign</h1>
      <p className="mt-1 text-sm text-gray-600">
        An ongoing initiative with a goal — e.g. &quot;Onboarding for Partner Admins.&quot; Add emails and
        sends to it once it&apos;s created.
      </p>

      <form action={handleCreate} className="mt-6 max-w-lg space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            name="name"
            required
            placeholder="Onboarding for Partner Admins"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Goal</label>
          <textarea
            name="goal"
            rows={3}
            placeholder="Get partner admins to fill in and correct their org profile and people."
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#163D6D]/30 focus:border-[#163D6D]"
          />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-[#EE2A2E] px-5 py-2 text-sm font-medium text-white hover:bg-[#D92327] transition-colors"
        >
          Create Campaign
        </button>
      </form>
    </main>
  );
}
