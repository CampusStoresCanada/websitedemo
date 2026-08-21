import Link from "next/link";
import { redirect } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import PartnerAskPanel from "@/components/comms/PartnerAskPanel";
import { listPartnerAsks, matchPartnersToAsk } from "@/lib/comms/partner-asks";
import { createCampaign } from "@/lib/comms/send";
import type { AudienceDefinition } from "@/lib/comms/types";

export const metadata = {
  title: "Partner Asks | Communications | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PartnerAsksPage({
  searchParams,
}: {
  searchParams: Promise<{ ask?: string; error?: string }>;
}) {
  const { ask: askParam, error: errorParam } = await searchParams;
  const asks = await listPartnerAsks();
  const selected = askParam ? asks.find((a) => String(a.id) === askParam) : undefined;
  const candidates = selected ? await matchPartnersToAsk(selected) : [];

  /**
   * Prepares a send — deliberately does NOT dispatch. It creates the campaign
   * and hands off to the existing review screen, so this tool can never become
   * a one-click blast. The operator still reads the copy and presses send there.
   */
  async function prepareSend(formData: FormData) {
    "use server";

    const askId = String(formData.get("ask_id") ?? "");
    const askTitle = String(formData.get("ask_title") ?? "");
    const picked = formData.getAll("recipient") as string[];
    if (!picked.length) return;

    const recipients = picked.map((entry) => {
      const [email, ...rest] = entry.split("|");
      return { email, name: rest.join("|") || null };
    });

    const audience: AudienceDefinition = {
      type: "custom_recipient_list",
      filters: { recipients },
    };

    // Copy lives in the `partner_ask_invite` template, editable at
    // /admin/comms/templates without a deploy — not hardcoded here. This
    // only supplies the per-ask variables. An admin who wants to tweak the
    // wording for one send can still do it on the review screen afterwards.
    const askerOrg = String(formData.get("asker_org") ?? "").trim();
    const result = await createCampaign({
      name: `Ask the Partners — ${askTitle.slice(0, 60)}`,
      templateKey: "partner_ask_invite" as Parameters<typeof createCampaign>[0]["templateKey"],
      variableValues: {
        ask_title: askTitle,
        ask_excerpt: String(formData.get("ask_excerpt") ?? ""),
        ask_url: String(formData.get("ask_url") ?? ""),
        asker_name: String(formData.get("asker_name") ?? ""),
        asker_org_suffix: askerOrg ? ` at ${askerOrg}` : "",
      },
      audience,
      triggerSource: "manual",
    });

    if (result.success && result.campaignId) {
      redirect(`/admin/comms/${result.campaignId}`);
    }
    // Surface the reason. Redirecting bare looked identical to "nothing was
    // ticked", so a real failure read as a no-op.
    const reason = result.error ?? "Campaign could not be created.";
    redirect(`/admin/comms/asks?ask=${askId}&error=${encodeURIComponent(reason)}`);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <AdminPageHeader
        title="Partner Asks"
        description="Open questions in Ask the Partners, and the partners who could answer them. Pick a few — this prepares a send for review, it never dispatches on its own."
        actions={
          <Link href="/admin/comms" className="text-sm text-red-600 hover:underline">
            ← Communications
          </Link>
        }
      />

      {errorParam && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>Couldn&apos;t prepare the send.</strong> {errorParam}
        </div>
      )}

      {asks.length === 0 ? (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          No open questions found in Ask the Partners.
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* ── Asks list ─────────────────────────────────────────── */}
          <aside className="space-y-2">
            {asks.map((a) => {
              const isSel = selected?.id === a.id;
              return (
                <Link
                  key={a.id}
                  href={`/admin/comms/asks?ask=${a.id}`}
                  className={`block rounded-lg border p-3 transition ${
                    isSel
                      ? "border-red-500 bg-red-50 ring-1 ring-red-500"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <div className="font-medium text-gray-900 text-sm">{a.title}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {a.askerName}
                    {a.askerOrg ? ` · ${a.askerOrg}` : ""}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span className="text-gray-400">
                      {a.publishedAt ? new Date(a.publishedAt).toLocaleDateString() : ""}
                    </span>
                    <span
                      className={
                        a.commentsCount === 0
                          ? "font-medium text-red-600"
                          : "text-gray-400"
                      }
                    >
                      {a.commentsCount} {a.commentsCount === 1 ? "reply" : "replies"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </aside>

          {/* ── Selected ask + candidates ─────────────────────────── */}
          <section>
            {!selected ? (
              <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
                Pick a question on the left to see who could answer it.
              </div>
            ) : (
              <PartnerAskPanel
                ask={selected}
                candidates={candidates}
                action={prepareSend}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
