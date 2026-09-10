"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { MarketMatch, MarketData } from "@/lib/actions/partner-market";
import { notifyMembersWithoutProcurement } from "@/lib/actions/partner-market";
import { recordMarketRating } from "@/lib/actions/market-ratings";
import {
  currentStanding,
  type RatingRow,
  type RatingAxis,
  type RatingValue,
} from "@/lib/match/rating-standing";

/**
 * ⛔ Two axes, never one scale.
 *
 * "Currently doing business together" is a FACT, and it means two opposite things
 * at once — the strongest evidence the engine was right, and a row that is
 * useless to show. On one scale with the quality grades, both signals are lost.
 *
 * ⚠️ Each fit grade names a DECISION rather than a strength. "Two thumbs" versus
 * "one thumb" has no shared meaning, so raters drift and the middle fills with
 * hedging; "would you approach them" is answerable the same way twice.
 */
const FIT_CHOICES: { value: RatingValue; label: string; on: string; hint: string }[] = [
  { value: "would_approach", label: "Would approach", on: "bg-green-600 text-white border-green-600",
    hint: "Worth contacting — the engine got this right." },
  { value: "wrong_time", label: "Right fit, wrong time", on: "bg-amber-500 text-white border-amber-500",
    hint: "Good match, not this season. We'll ask again rather than drop them." },
  { value: "not_a_fit", label: "Not a fit", on: "bg-red-600 text-white border-red-600",
    hint: "The engine misread this store, or misread you." },
];

interface PartnerMarketPanelProps {
  market: MarketData;
  canNudge?: boolean;
  nudgeAvailableAt?: string | null;
  /** Org name suffix for multi-org contexts (e.g., My Account with several Partner orgs) */
  orgName?: string;
  /** Unique anchor id — defaults to "your-market"; override to avoid collisions when rendering multiple instances on one page */
  anchorId?: string;
  /** Override the outer wrapper classes — e.g., to fit a rounded-card layout instead of the org page's full-bleed section */
  containerClassName?: string;
  /**
   * ⛔ Org ADMINS only. Reading this market is an org-level perk; rating it is an
   * admin act, because `is_customer` is the org's customer list and not every
   * member of staff should be publishing it.
   */
  canRate?: boolean;
  /** Every verdict this partner has recorded. Staleness is computed here, from now. */
  ratings?: RatingRow[];
  /** Whose market this is — the org a verdict is recorded against and authorized by. */
  partnerOrgId?: string;
}

function ConfidencePip({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const styles = { high: "bg-green-500", medium: "bg-amber-400", low: "bg-gray-300" };
  const labels = { high: "Strong match", medium: "Likely match", low: "Broad match" };
  return (
    <span title={labels[confidence]} className={`inline-block w-2 h-2 rounded-full flex-shrink-0 mt-1 ${styles[confidence]}`} />
  );
}

function ContactLine({ match }: { match: MarketMatch }) {
  const contact = match.buyer ?? match.primaryContact;
  if (contact) {
    return (
      <div className="text-xs text-gray-500 mt-0.5">
        {contact.name && <span className="font-medium text-gray-700">{contact.name}</span>}
        {contact.roleTitle && <span className="text-gray-400"> · {contact.roleTitle}</span>}
        {contact.email && (
          <>
            <span className="text-gray-300 mx-1">·</span>
            <a href={`mailto:${contact.email}`} className="text-[#EE2A2E] hover:underline">{contact.email}</a>
          </>
        )}
      </div>
    );
  }
  if (match.publicEmail) {
    return (
      <div className="text-xs text-gray-500 mt-0.5">
        <a href={`mailto:${match.publicEmail}`} className="text-[#EE2A2E] hover:underline">{match.publicEmail}</a>
        <span className="text-gray-400 ml-1">(general inbox)</span>
      </div>
    );
  }
  return <p className="text-xs text-gray-400 mt-0.5 italic">No contact on file</p>;
}

export default function PartnerMarketPanel({
  market,
  canNudge = false,
  nudgeAvailableAt = null,
  orgName,
  anchorId = "your-market",
  containerClassName,
  canRate = false,
  ratings = [],
  partnerOrgId,
}: PartnerMarketPanelProps) {
  const [nudgeSent, setNudgeSent] = useState(false);
  const [nudgeSending, setNudgeSending] = useState(false);
  const [nudgeError, setNudgeError] = useState<string | null>(null);

  // Local echo so a click lands instantly; the server action is the record.
  const [local, setLocal] = useState<Record<string, RatingValue>>({});
  const [rateFailed, setRateFailed] = useState<Record<string, true>>({});
  const [, startRating] = useTransition();
  // ⚠️ One `now` for the render, so two rows cannot disagree about whether the
  // same month has elapsed.
  const [now] = useState(() => new Date());

  const rate = (
    memberOrgId: string, axis: RatingAxis, value: RatingValue, rank: number
  ) => {
    if (!partnerOrgId) return;
    const k = `${memberOrgId}:${axis}`;
    setLocal((p) => ({ ...p, [k]: value }));
    setRateFailed((p) => { const n = { ...p }; delete n[k]; return n; });
    startRating(async () => {
      // ⛔ The action re-checks the caller against `partnerOrgId`. This component
      // only decides what to SHOW; it is never the thing granting permission.
      const res = await recordMarketRating({
        partnerOrgId, memberOrgId, axis, value, runId: market.runId, rank,
      });
      // ⚠️ Roll back if it did not land. A button left coloured shows a verdict
      // that exists nowhere — and here that could mean a partner believing they
      // have flagged a customer we are still advertising to them as a prospect.
      if (!res.ok) {
        setLocal((p) => { const n = { ...p }; delete n[k]; return n; });
        setRateFailed((p) => ({ ...p, [k]: true }));
      }
    });
  };

  const standingFor = (memberOrgId: string) => {
    const stored = currentStanding(ratings, memberOrgId, now);
    const fitLocal = local[`${memberOrgId}:fit`];
    const relLocal = local[`${memberOrgId}:relationship`];
    return {
      fit: fitLocal ?? stored.fit?.value ?? null,
      fitStale: !fitLocal && !!stored.fit?.stale,
      isCustomer: (relLocal ?? stored.relationship?.value) === "is_customer",
      relStale: !relLocal && !!stored.relationship?.stale,
    };
  };

  async function handleNudge() {
    setNudgeSending(true);
    setNudgeError(null);
    const res = await notifyMembersWithoutProcurement("__self__", null);
    setNudgeSending(false);
    if (res.success) {
      setNudgeSent(true);
    } else {
      setNudgeError(res.error ?? "Something went wrong");
    }
  }

  return (
    <div id={anchorId} className={containerClassName ?? "bg-white border-t border-gray-200"}>
      <div className="max-w-7xl mx-auto px-8 py-12">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-[#1A1A1A]">
              Your Market{orgName ? ` — ${orgName}` : ""}
            </h2>
            {market.totalMatches > 0 && (
              <p className="text-sm text-gray-500 mt-1">
                {market.totalMatches} member {market.totalMatches === 1 ? "store" : "stores"} carry your categories
                {market.totalMatches > 10 && " — showing top 10"}
              </p>
            )}
          </div>
          {market.totalMatches > 0 && (
            <p className="text-xs text-gray-400 text-right max-w-[200px] leading-snug">
              Use <span className="font-medium text-gray-600">Export</span> in the Toolkit for the full list with all contacts.
            </p>
          )}
        </div>

        {/* No categories set */}
        {market.totalMatches === 0 && market.withoutProcurementCount === 0 && (
          <p className="text-sm text-gray-500">Add categories to your profile to see which member stores are in your market.</p>
        )}

        {/* Match list */}
        {market.topMatches.length > 0 && (
          <div className="space-y-2 mb-8">
            {market.topMatches.map((match) => (
              <div key={match.orgId} className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-all ${
                canRate && standingFor(match.orgId).isCustomer
                  // ⛔ Dimmed, NOT removed. A row that vanishes on click cannot be
                  // un-clicked — an accidental "already a customer" would hide a
                  // real prospect permanently, from the one screen able to undo it.
                  // Prospect counts and exports are where the suppression belongs.
                  ? "border-blue-100 bg-blue-50/40 opacity-70"
                  : "border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm"
              }`}>
                <ConfidencePip confidence={match.confidence} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/org/${match.orgSlug}`} className="text-sm font-semibold text-[#1A1A1A] hover:text-[#EE2A2E] transition-colors">
                      {match.orgName}
                    </Link>
                    {match.province && <span className="text-xs text-gray-400">{match.province}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-400">{match.matchingCategory}</span>
                    {match.matchingSubcategories.length > 0 && (
                      <>
                        <span className="text-gray-300">›</span>
                        <span className="text-xs text-gray-500">{match.matchingSubcategories.join(", ")}</span>
                      </>
                    )}
                  </div>
                  <ContactLine match={match} />

                  {canRate && partnerOrgId && (() => {
                    const st = standingFor(match.orgId);
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {/*
                          ⛔ The relationship toggle sits apart from the grades, with a
                          divider, because it is a different kind of statement. An
                          existing customer is simultaneously the best evidence the
                          engine works and the least useful row on this page.
                        */}
                        <button
                          type="button"
                          title="You already sell to this store. We'll stop showing them as a prospect — and ask again in a few months, because accounts change."
                          onClick={() => rate(match.orgId, "relationship", st.isCustomer ? "not_customer" : "is_customer", match.rank)}
                          className={`rounded border px-2 py-0.5 text-xs transition ${
                            st.isCustomer
                              ? "bg-blue-600 text-white border-blue-600"
                              : "border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-700"
                          }`}
                        >
                          {st.isCustomer ? "✓ Current customer" : "Already a customer"}
                        </button>

                        <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden />

                        {FIT_CHOICES.map((c) => (
                          <button
                            key={c.value}
                            type="button"
                            title={c.hint}
                            onClick={() => rate(match.orgId, "fit", c.value, match.rank)}
                            className={`rounded border px-2 py-0.5 text-xs transition ${
                              st.fit === c.value ? c.on : "border-gray-300 text-gray-500 hover:border-gray-400"
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}

                        {/*
                          ⚠️ Stale is shown, never silently reverted. The claim is still
                          being honoured; we are asking whether it still holds. Dropping
                          it quietly would be the same error as reading "no rows" as
                          "no answer".
                        */}
                        {(st.fitStale || st.relStale) && (
                          <span className="text-xs text-amber-600" title="You told us this a while ago — still true?">
                            still true?
                          </span>
                        )}
                        {(rateFailed[`${match.orgId}:fit`] || rateFailed[`${match.orgId}:relationship`]) && (
                          <span className="text-xs text-red-600">not saved</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Members without procurement */}
        {market.withoutProcurementCount > 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-4">
            <p className="text-sm font-medium text-gray-700">
              {market.withoutProcurementCount} member {market.withoutProcurementCount === 1 ? "store hasn't" : "stores haven't"} set up their procurement data yet.
            </p>

            <div className="mt-2">
              {nudgeSent ? (
                <p className="text-xs text-green-600 font-medium">
                  ✓ Ghost Butler will reach out to them shortly.
                </p>
              ) : canNudge ? (
                <button
                  type="button"
                  onClick={() => void handleNudge()}
                  disabled={nudgeSending}
                  className="text-xs text-[#EE2A2E] hover:text-[#D92327] font-medium transition-colors disabled:opacity-50"
                >
                  {nudgeSending ? "Sending…" : "Let them know you're looking →"}
                </button>
              ) : nudgeAvailableAt ? (
                <p className="text-xs text-gray-400">
                  Notification already sent this week — available again {new Date(nudgeAvailableAt).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}.
                </p>
              ) : null}
              {nudgeError && <p className="text-xs text-red-500 mt-1">{nudgeError}</p>}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
