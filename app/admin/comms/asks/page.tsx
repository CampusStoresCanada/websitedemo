import Link from "next/link";
import { redirect } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import PartnerAskPanel from "@/components/comms/PartnerAskPanel";
import { listPartnerAsks } from "@/lib/comms/partner-asks";
import { getCircleClient } from "@/lib/circle/client";
import {
  askCandidates,
  loadJudgements,
  recordAskSelection,
  recordJudgement,
  resolveActingContact,
} from "@/lib/comms/ask-candidates";
import type { AskPanelCandidate, Verdict } from "@/components/comms/PartnerAskPanel";
import { getServerAuthState } from "@/lib/auth/server";
import { createCampaign } from "@/lib/comms/send";
import type { AudienceDefinition } from "@/lib/comms/types";
import type { CircleState } from "@/lib/comms/partner-asks";

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

  /**
   * ⛔ Reads the overnight ranking, never the old word matcher.
   *
   * The engine embeds every question and every partner's own writing in one
   * space; that matcher counted shared words, which is how "self-duplicating
   * notebooks" surfaced vendors for the word "book". It still exists as the
   * baseline in `scripts/cluster-bench/ask-compare.mts` and belongs nowhere else.
   *
   * ⚠️ Ranking happens on the Mac overnight — the model that embeds a question
   * must be the same one that embedded everyone else, and that model is not
   * running on Vercel. A question posted today is scored tomorrow. The panel says
   * so rather than showing an empty list.
   */
  const ranking = selected
    ? await askCandidates(String(selected.id), "silent-partners")
    : { scored: true, candidates: [], filtered: 0 };

  // Circle account state, one sweep. Not a ranking input — an operational
  // warning: this email says "go answer on Circle", and for somebody with no
  // account that link does not work. Failure leaves everyone reading as
  // "absent", which is the direction that over-warns rather than under-warns.
  const circleState = new Map<string, CircleState>();
  if (ranking.candidates.length) {
    const client = getCircleClient();
    if (client) {
      try {
        const map = await client.buildEmailMap();
        for (const [email, m] of map) {
          circleState.set(email.toLowerCase(), m.active ? "active" : "invited");
        }
      } catch {
        /* leave empty — everyone reads as absent */
      }
    }
  }

  /**
   * Verdicts already recorded for the partners on this list.
   *
   * ⛔ Loaded for the SEND list, not for the candidates we filtered out. The
   * silent partners ARE the product — the carrot exists to pull them into the
   * community — so whether the engine picked the right ones is the question worth
   * a human's attention. Rating people who are already active would teach us
   * about the ranking in the abstract while the actual decision went unmeasured.
   */
  const judgements = ranking.candidates.length && selected
    ? await loadJudgements(String(selected.id))
    : new Map<string, { verdict: Verdict; judgedAt: string }>();

  const candidates: AskPanelCandidate[] = ranking.candidates
    // No email, no send. The engine ranks people it has writing for, which is
    // not the same set as people we can reach.
    .filter((c) => c.email)
    .map((c) => ({
      contactId: c.contactId,
      orgId: c.orgId,
      name: c.personName ?? c.orgName,
      email: c.email as string,
      orgName: c.orgName,
      circleState: circleState.get((c.email as string).toLowerCase()) ?? "absent",
      rank: c.rank,
      // The engine's reason is one act in the partner's own words. Kept verbatim
      // and unpadded — an invented second bullet would look like more evidence
      // than there is.
      reasons: c.reason ? [c.reason] : [],
      lastSpokeAt: c.lastSpokeAt,
      viaOrgContact: c.viaOrgContact,
      // ⚠️ Keyed exactly as `candidateKey` builds it. Getting this wrong shows
      // every row unrated and quietly invites a second verdict on rows that
      // already have one.
      verdict: judgements.get(`${c.orgId}::${c.contactId ?? ""}`)?.verdict ?? null,
    }));

  /**
   * Record one verdict on a ranking.
   *
   * ⛔ Returns a plain result rather than throwing or redirecting. This runs from
   * a button inside the page, not a form submit — a throw would surface as an
   * unhandled action error over a screen the operator is mid-way through, for the
   * sake of a rating nobody asked them to give.
   */
  async function judgeCandidate(
    orgId: string,
    contactId: string | null,
    rank: number,
    verdict: Verdict
  ): Promise<{ ok: boolean }> {
    "use server";
    if (!askParam) return { ok: false };
    try {
      const { profile } = await getServerAuthState();
      const judgedBy = await resolveActingContact(profile?.id ?? null);
      return await recordJudgement({
        askRef: askParam, orgId, contactId, rank, verdict, judgedBy,
      });
    } catch (err) {
      console.warn("[asks] judgement failed:", err instanceof Error ? err.message : err);
      return { ok: false };
    }
  }

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

    /**
     * What the human decided, recorded BEFORE the campaign is created.
     *
     * ⛔ Before, deliberately. `createCampaign` can fail, and when it does the
     * operator's judgement is still a real fact we want — they read our list and
     * chose these five. Recording after would throw away exactly the cases where
     * something went wrong, which are the ones worth studying.
     *
     * This is the loop the recommender is graded on:
     *     shown ⊇ chosen ⊇ replied
     * and `recordAskSelection` writes an unrecommended row for anyone the
     * operator added that we never surfaced — a labelled miss.
     */
    const chosen = (formData.getAll("pick") as string[])
      .map((entry) => {
        const [orgId, contactId] = entry.split("|");
        return { orgId, contactId: contactId || null };
      })
      .filter((c) => c.orgId);

    /**
     * ⛔ The log must never be able to take the send down with it.
     *
     * `recordAskSelection` handles the errors it can see — a Supabase call that
     * comes back with an error object — but a THROW here is different: it leaves
     * this server action entirely, and it does so BEFORE the campaign is created,
     * so an operator who picked five partners gets nothing and no explanation.
     * Measurement failing is a bad day for the evaluation data; measurement
     * taking the work with it is a bad day for the person at the screen.
     */
    if (chosen.length) {
      try {
        const { profile } = await getServerAuthState();
        const selectedBy = await resolveActingContact(profile?.id ?? null);
        await recordAskSelection({ askRef: askId, selectedBy, chosen });
      } catch (err) {
        console.warn(
          `[asks] selection log threw for ask ${askId} — sending anyway:`,
          err instanceof Error ? err.message : err
        );
      }
    }

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
                scored={ranking.scored}
                filtered={ranking.filtered}
                action={prepareSend}
                onJudge={judgeCandidate}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
