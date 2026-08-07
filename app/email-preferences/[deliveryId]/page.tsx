import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveDeliveryForPreferences } from "@/lib/comms/preferences";
import {
  getSuppressionsForEmail,
  unsubscribeEmail,
  resubscribeEmail,
  GLOBAL_SUPPRESSION_CATEGORY,
} from "@/lib/comms/suppressions";
import type { TemplateCategory } from "@/lib/comms/types";

export const metadata = {
  title: "Email Preferences | Campus Stores Canada",
};

export const dynamic = "force-dynamic";

// Renewal and user_mgmt templates are always transactional (account/billing
// operations — see the is_transactional migration), so there's nothing in
// those categories a recipient could usefully unsubscribe from.
const MANAGEABLE_CATEGORIES: { value: TemplateCategory; label: string; blurb: string }[] = [
  { value: "conference", label: "Conference", blurb: "Registration reminders, schedule updates, and conference promotion." },
  { value: "membership", label: "Membership", blurb: "Membership news, benefits, and promotional emails." },
  { value: "events", label: "Events", blurb: "Announcements and promotion for member-hosted events." },
  { value: "general", label: "General announcements", blurb: "Newsletters and other Campus Stores Canada news." },
];

async function unsubscribeAllAction(deliveryId: string) {
  "use server";
  const info = await resolveDeliveryForPreferences(deliveryId);
  if (!info) return;
  await unsubscribeEmail(info.email, GLOBAL_SUPPRESSION_CATEGORY, "self-serve: unsubscribe from all");
  revalidatePath(`/email-preferences/${deliveryId}`);
}

async function resubscribeAllAction(deliveryId: string) {
  "use server";
  const info = await resolveDeliveryForPreferences(deliveryId);
  if (!info) return;
  await resubscribeEmail(info.email, GLOBAL_SUPPRESSION_CATEGORY);
  revalidatePath(`/email-preferences/${deliveryId}`);
}

async function savePreferencesAction(deliveryId: string, formData: FormData) {
  "use server";
  const info = await resolveDeliveryForPreferences(deliveryId);
  if (!info) return;
  for (const { value } of MANAGEABLE_CATEGORIES) {
    const wantsSuppressed = formData.get(`suppress_${value}`) === "on";
    if (wantsSuppressed) {
      await unsubscribeEmail(info.email, value, "self-serve: category preferences");
    } else {
      await resubscribeEmail(info.email, value);
    }
  }
  revalidatePath(`/email-preferences/${deliveryId}`);
}

export default async function EmailPreferencesPage({
  params,
}: {
  params: Promise<{ deliveryId: string }>;
}) {
  const { deliveryId } = await params;
  const info = await resolveDeliveryForPreferences(deliveryId);
  if (!info) notFound();

  const suppressed = new Set(await getSuppressionsForEmail(info.email));
  const isGloballyUnsubscribed = suppressed.has(GLOBAL_SUPPRESSION_CATEGORY);

  const boundUnsubscribeAll = unsubscribeAllAction.bind(null, deliveryId);
  const boundResubscribeAll = resubscribeAllAction.bind(null, deliveryId);
  const boundSavePreferences = savePreferencesAction.bind(null, deliveryId);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Email preferences</h1>
            <p className="text-gray-600 text-sm">
              Managing preferences for{" "}
              <span className="font-medium text-gray-900">{info.email}</span>.
              This doesn&apos;t require an account or login, and changes take effect immediately.
            </p>
          </div>

          {isGloballyUnsubscribed ? (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
              <p className="text-sm text-gray-700">
                You&apos;re unsubscribed from all Campus Stores Canada marketing emails.
              </p>
              <form action={boundResubscribeAll} className="mt-3">
                <button
                  type="submit"
                  className="text-sm font-medium text-accent hover:text-accent-hover"
                >
                  Resubscribe
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-red-50 border border-red-100 p-4">
                <p className="text-sm font-medium text-gray-900 mb-2">
                  Don&apos;t want any marketing emails from us?
                </p>
                <form action={boundUnsubscribeAll}>
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-[#EE2A2E] text-white text-sm font-medium rounded-lg hover:bg-[#D92327] transition-colors"
                  >
                    Unsubscribe from all
                  </button>
                </form>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <p className="text-sm font-medium text-gray-900 mb-1">
                  Or manage by category
                </p>
                <p className="text-xs text-gray-500 mb-4">
                  Check the categories you&apos;d like to stop receiving. Leave the rest as is.
                </p>
                <form action={boundSavePreferences} className="space-y-3">
                  {MANAGEABLE_CATEGORIES.map((cat) => (
                    <label
                      key={cat.value}
                      className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        name={`suppress_${cat.value}`}
                        defaultChecked={suppressed.has(cat.value)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-900">
                          Stop {cat.label.toLowerCase()} emails
                        </span>
                        <span className="block text-xs text-gray-500">{cat.blurb}</span>
                      </span>
                    </label>
                  ))}
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
                  >
                    Save preferences
                  </button>
                </form>
              </div>
            </>
          )}

          <p className="mt-6 pt-6 border-t border-gray-200 text-xs text-gray-500">
            These preferences only apply to marketing and promotional emails. You&apos;ll
            still receive operational emails you&apos;re entitled to — things like renewal
            notices, receipts, and account or registration confirmations.
          </p>
        </div>
      </div>
    </div>
  );
}
