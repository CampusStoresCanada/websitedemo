/**
 * The feature axes. Each is a pure function of two profiles plus a context,
 * returning a 0..1 value and the reasons that produced it.
 *
 * ⚠️ Returning `null` means "neither side had anything to say on this axis" and
 * is materially different from returning 0, which means "they had something to
 * say and it did not match". `scorePair` renormalises over the non-null axes, so
 * a member who has never filled in procurement_info is scored on what is known
 * about them rather than punished for the blanks.
 */

import { CERTIFICATION_NAMES } from "@/lib/certifications";
import { CANADIAN_PROVINCES } from "@/lib/types/procurement";
import type {
  FeatureResult,
  MatchDirection,
  MatchProfile,
  MatchReason,
  NormalizedBuyingCycle,
  ReasonVisibility,
} from "./types";

export interface FeatureContext {
  direction: MatchDirection;
  /** Reference date for every time-dependent axis. Passed in so scoring stays pure. */
  now: Date;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Certifications populated from another column rather than declared by anyone.
 *
 * ⚠️ "Buy Ontario" sits on 41 of the 80 live partners. All 41 are in Ontario and
 * not one partner outside Ontario holds it — the province column wearing a
 * badge, the same trap as `nacs_department`.
 *
 * ⚠️ Corrected 2026-09-01 from "65", which counted ARCHIVED partners: 65 = 41
 * live + 24 archived. Two other sessions measured 41 and were right. Any count
 * over `organizations` needs `archived_at is null` as well as `is_test` — 41 of
 * 121 partners are archived, so leaving it off inflates every partner figure by
 * roughly half.
 *
 * ⚠️ Sparser than even that suggests: only 47 of 81 partners hold ANY
 * certification, and 41 of those 47 are this one derived badge.
 * Crediting it as a *chosen* certification would overstate the evidence and
 * double-count the province axis, which scores the identical fact.
 *
 * Measured 2026-08-31. If partners are ever asked to declare this themselves,
 * remove it from here.
 */
const DERIVED_CERTIFICATIONS = new Set(["Buy Ontario"]);

const lower = (values: string[]) => values.map((v) => v.trim().toLowerCase()).filter(Boolean);

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(lower(right));
  const seen = new Set<string>();
  return left.filter((value) => {
    const key = value.trim().toLowerCase();
    if (!rightSet.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Provenance for a reason: whose data it reveals, and how they have it set.
 *
 * ⛔ Not a permission check. This engine does not decide who may see anything —
 * it records what a consumer needs in order to decide for itself, because the
 * audiences are elsewhere and unknowable from here.
 */
function provenance(
  owner: MatchProfile,
  flag: boolean | undefined
): { sourceOrgId: string; sourceVisibility: ReasonVisibility } {
  return {
    sourceOrgId: owner.id,
    sourceVisibility: flag === undefined ? "unset" : flag ? "shown" : "hidden",
  };
}

/** The buyer/supplier pair, or null for same-type directions where neither role applies. */
function sides(
  subject: MatchProfile,
  candidate: MatchProfile
): { buyer: MatchProfile; supplier: MatchProfile } | null {
  if (subject.type === "member" && candidate.type === "partner") {
    return { buyer: subject, supplier: candidate };
  }
  if (subject.type === "partner" && candidate.type === "member") {
    return { buyer: candidate, supplier: subject };
  }
  return null;
}

const none = (axis: FeatureResult["axis"]): FeatureResult => ({ axis, value: null, reasons: [] });

// ── 1. Category ──────────────────────────────────────────────────────────────

/**
 * NACS taxonomy overlap, weighting class above department.
 *
 * Preferring class over department is deliberate: "hoodies" resolves to both
 * `Apparel` (nearly the whole floor) and `Activewear` (the precise signal), and
 * treating either hit as equal is what made one query match 21 of 60 booths.
 *
 * ⚠️ In `partner_to_partner`, overlap means COMPETITOR, not match. Same
 * department with disjoint classes is the complementary case — two vendors
 * selling different things to the same buyers.
 */
export function categoryFeature(
  subject: MatchProfile,
  candidate: MatchProfile,
  ctx: FeatureContext
): FeatureResult {
  const axis = "category" as const;
  const subjectHasAny = subject.departments.length > 0 || subject.classes.length > 0;
  const candidateHasAny = candidate.departments.length > 0 || candidate.classes.length > 0;
  if (!subjectHasAny || !candidateHasAny) return none(axis);

  const sharedClasses = intersect(subject.classes, candidate.classes);
  const sharedDepartments = intersect(subject.departments, candidate.departments);

  // ⚠️ Only the CANDIDATE's flag matters.
  //
  // `citable` answers one question: may this be shown to the subject, who is the
  // audience of this ranked list. An earlier version AND-ed in whether the
  // SUBJECT's own categories were visible to the candidate — which is a question
  // about the reverse edge, not this one, and had the effect of hiding a member's
  // own answers from their own screen. Hiding is directional: it conceals from
  // partners, never from the person who set it.
  const from = provenance(candidate, candidate.visibility.show_categories);

  if (ctx.direction === "partner_to_partner") {
    if (sharedClasses.length > 0) {
      return {
        axis,
        value: 0.15,
        reasons: [
          {
            kind: "chosen",
            axis,
            text: `Sells into the same class as you — ${sharedClasses.join(", ")}`,
            evidence: sharedClasses,
            supports: false, // a rivalry note, not an argument for the pairing
            ...from,
          },
        ],
      };
    }
    if (sharedDepartments.length > 0) {
      return {
        axis,
        value: 0.8,
        reasons: [
          {
            kind: "chosen",
            axis,
            text: `Serves the same buyers in ${sharedDepartments.join(", ")} without overlapping your shelf`,
            evidence: sharedDepartments,
            supports: true,
            ...from,
          },
        ],
      };
    }
    // ⛔ Nothing shared, so nothing to say — null, not a floor.
    //
    // This returned 0.25 and it was wrong in the way this engine is most careful
    // about elsewhere: an invented number for the absence of evidence. Measured
    // on the first real run, 2,243 of 3,700 partner_to_partner edges (61%) were
    // that one constant, so the direction was mostly storing "we have no idea"
    // dressed as a rank. With the axis silent these pairs are scoreless and are
    // dropped, which is what "we have no idea" should look like in a table.
    return none(axis);
  }

  if (sharedClasses.length > 0) {
    const denominator = Math.min(subject.classes.length, candidate.classes.length) || 1;
    const value = Math.min(1, 0.6 + 0.4 * (sharedClasses.length / denominator));
    const reasons: MatchReason[] = [
      {
        kind: "chosen",
        axis,
        text: `Matches on ${sharedClasses.join(", ")}`,
        evidence: sharedClasses,
        supports: true,
        ...from,
      },
    ];
    return { axis, value, reasons };
  }

  if (sharedDepartments.length > 0) {
    const denominator = Math.min(subject.departments.length, candidate.departments.length) || 1;
    // Capped well below a class match: a department is a broad claim, and letting
    // it reach the same score is how a whole category reads as a precise answer.
    const chosenValue = Math.min(0.35, 0.35 * (sharedDepartments.length / denominator));
    const reasons: MatchReason[] = [
      {
        kind: "chosen",
        axis,
        text: `Both in ${sharedDepartments.join(", ")}`,
        evidence: sharedDepartments,
        supports: true,
        ...from,
      },
    ];

    // Behaviour supplies the precision the form did not. Members ticked
    // departments — 0 of 81 set primary_category, and only one of the thirteen
    // with procurement data filled in subcategories — but they SEARCH for
    // classes. A revealed class match inside a shared department is the case
    // this exists for.
    const revealed = revealedClassMatch(subject, candidate);
    if (revealed) {
      return {
        axis,
        value: Math.max(chosenValue, revealed.value),
        reasons: [revealed.reason, ...reasons],
      };
    }

    return { axis, value: chosenValue, reasons };
  }

  // Nothing chosen lines up — but behaviour might still.
  const revealedOnly = revealedClassMatch(subject, candidate);
  if (revealedOnly) {
    return { axis, value: revealedOnly.value, reasons: [revealedOnly.reason] };
  }

  return { axis, value: 0, reasons: [] };
}

/**
 * Terms the subject went looking for that the candidate actually carries.
 *
 * ⚠️ Deliberately weaker than the same match by declaration, and reported as
 * `behavioural`, not `chosen` — searching for something is evidence of interest,
 * not a statement that you buy it. A guess must look like a guess, and so must
 * an inference from behaviour.
 *
 * The reason text is written differently depending on who is reading: a store
 * sees its own activity described plainly, while the other party is told only
 * that there is recent interest — never a count, never who.
 */
function revealedClassMatch(
  subject: MatchProfile,
  candidate: MatchProfile
): { value: number; reason: MatchReason } | null {
  // ⚠️ SYMMETRIC. An earlier version read only the subject's revealed terms,
  // which silently broke `partner_to_member` — the useful signal there is what
  // the MEMBER has been searching for, held on the candidate, and a partner
  // asking "who could buy from me" got none of it.
  const own = matchRevealed(subject.revealedTerms, candidate);
  const theirs = matchRevealed(candidate.revealedTerms, subject);
  const best = !own ? theirs : !theirs ? own : own.weight >= theirs.weight ? own : theirs;
  if (!best) return null;

  // Caps at 0.75 — below a declared class match (0.6–1.0, overlap-dependent),
  // because behaviour is interest and a selection is a statement.
  const value = Math.min(0.75, 0.35 + 0.4 * best.weight);
  const isSubjectsOwn = best === own;

  return {
    value,
    reason: {
      kind: "behavioural",
      axis: "category",
      text: isSubjectsOwn
        ? `Your team has been looking at ${best.terms.join(", ")}`
        : `Recent interest there in ${best.terms.join(", ")}`,
      evidence: best.terms,
      supports: true,
      // ⚠️ Carries no count and no person — the aggregate framing IS the
      // sentence. "Recent interest there" is the most that may be said about
      // another org's behaviour; never how much, never how many, never who.
      sourceOrgId: null,
      sourceVisibility: "unset",
    },
  };
}

/** Strongest revealed term of one side that the other side actually carries. */
function matchRevealed(
  revealed: MatchProfile["revealedTerms"],
  against: MatchProfile
): { weight: number; terms: string[] } | null {
  if (revealed.length === 0) return null;
  const carried = new Set(lower([...against.classes, ...against.departments]));
  const hits = revealed
    .filter((t) => carried.has(t.term.trim().toLowerCase()))
    .sort((a, b) => b.weight - a.weight);
  if (hits.length === 0) return null;
  return { weight: hits[0].weight, terms: hits.slice(0, 3).map((h) => h.term) };
}

// ── 2. Certification ─────────────────────────────────────────────────────────

/**
 * What the buyer asked for against what the supplier holds.
 *
 * This is a hard join between two controlled vocabularies and is the strongest
 * evidence available anywhere in the system. It is currently worth `+0.25` in
 * one file and nothing anywhere else.
 */
export function certificationFeature(
  subject: MatchProfile,
  candidate: MatchProfile
): FeatureResult {
  const axis = "certification" as const;
  const pair = sides(subject, candidate);
  if (!pair) return none(axis);

  const { buyer, supplier } = pair;
  if (buyer.certificationsWanted.length === 0) return none(axis);

  const met = intersect(buyer.certificationsWanted, supplier.certificationsHeld);
  const value = met.length / buyer.certificationsWanted.length;
  const from = provenance(buyer, buyer.visibility.show_certifications);

  if (met.length === 0) {
    const missing = buyer.certificationsWanted;
    return {
      axis,
      value: 0,
      reasons: [
        {
          kind: "chosen",
          axis,
          text:
            subject.id === buyer.id
              ? `Holds none of the certifications you look for (${missing.join(", ")})`
              : `You hold none of the certifications they look for (${missing.join(", ")})`,
          evidence: missing,
          supports: false,
          ...from,
        },
      ],
    };
  }

  // A match made only of derived badges is not a declaration by anyone, so it
  // must not present as `chosen`.
  const declared = met.filter((cert) => !DERIVED_CERTIFICATIONS.has(cert));
  const derivedOnly = declared.length === 0;

  return {
    axis,
    value,
    reasons: [
      {
        kind: derivedOnly ? "derived" : "chosen",
        axis,
        text: derivedOnly
          ? `Inferred from location: ${met.join(", ")}`
          : subject.id === buyer.id
            ? `Certified ${declared.join(", ")} — which you ask for`
            : `They ask for ${declared.join(", ")}, which you hold`,
        evidence: met,
        supports: true,
        ...from,
      },
    ],
  };
}

// ── 3. Province ──────────────────────────────────────────────────────────────

/**
 * The buyer's sourcing preference against where the supplier is.
 *
 * ⚠️ A member who ticked every province has expressed no constraint at all, so
 * that reads as silence rather than as a match against everyone. One live record
 * lists all thirteen.
 */
export function provinceFeature(subject: MatchProfile, candidate: MatchProfile): FeatureResult {
  const axis = "province" as const;
  const pair = sides(subject, candidate);
  if (!pair) return none(axis);

  const { buyer, supplier } = pair;
  const wanted = buyer.sourcingProvinces;
  if (wanted.length === 0) return none(axis);
  if (wanted.length >= CANADIAN_PROVINCES.length - 2) return none(axis);
  if (!supplier.province) return none(axis);

  const hit = intersect([supplier.province], wanted).length > 0;
  const from = provenance(buyer, buyer.visibility.show_provinces);

  return {
    axis,
    value: hit ? 1 : 0,
    reasons: hit
      ? [
          {
            kind: "chosen",
            axis,
            text:
              subject.id === buyer.id
                ? `Based in ${supplier.province}, which you source from`
                : `You're in ${supplier.province} — one of the provinces they source from`,
            evidence: [supplier.province],
            supports: true,
            ...from,
          },
        ]
      : [],
  };
}

// ── 4. Timing ────────────────────────────────────────────────────────────────

function monthInRange(month: number, start: number, end: number): boolean {
  // A window that wraps the year end (Nov–Feb) has start > end; flattening it
  // would invert the meaning into Feb–Nov, i.e. most of the year.
  return start <= end ? month >= start && month <= end : month >= start || month <= end;
}

/** Days until the next occurrence, treating recurring dates as annual. */
function daysUntil(dateIso: string, recurring: boolean, now: Date): number | null {
  const parsed = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const dayMs = 86_400_000;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  if (!recurring) return Math.round((parsed.getTime() - today) / dayMs);

  for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
    const next = Date.UTC(
      now.getUTCFullYear() + yearOffset,
      parsed.getUTCMonth(),
      parsed.getUTCDate()
    );
    if (next >= today) return Math.round((next - today) / dayMs);
  }
  return null;
}

/**
 * Is this buyer in market, or about to be?
 *
 * The sales question, and the reason `partner_to_member` weights it hardest —
 * "UBC's RFP window opens in November" is worth more to a partner than one more
 * category overlap. `buying_cycle` currently drives nothing outside the
 * conference scheduler.
 */
export function timingFeature(
  subject: MatchProfile,
  candidate: MatchProfile,
  ctx: FeatureContext
): FeatureResult {
  const axis = "timing" as const;
  const pair = sides(subject, candidate);
  if (!pair) return none(axis);

  const { buyer } = pair;
  const cycle: NormalizedBuyingCycle | null = buyer.buyingCycle;
  if (!cycle) return none(axis);

  const from = provenance(buyer, buyer.visibility.show_buying_cycle);
  const month = ctx.now.getUTCMonth() + 1;
  const reasons: MatchReason[] = [];
  let value = 0.2; // they told us they have a cycle; it just isn't now

  if (cycle.rfpWindow && monthInRange(month, cycle.rfpWindow.startMonth, cycle.rfpWindow.endMonth)) {
    value = 1;
    reasons.push({
      kind: "stated",
      axis,
      text:
        subject.id === buyer.id
          ? "Your RFP window is open now"
          : "Their RFP window is open now",
      evidence: [`months ${cycle.rfpWindow.startMonth}–${cycle.rfpWindow.endMonth}`],
      supports: true,
      ...from,
    });
  }

  for (const keyDate of cycle.keyDates) {
    const days = daysUntil(keyDate.date, keyDate.recurring, ctx.now);
    if (days === null || days < 0 || days > 90) continue;
    // Closer is more urgent, but never above an open RFP window.
    const proximity = 0.55 + 0.35 * (1 - days / 90);
    if (proximity > value) value = proximity;
    reasons.push({
      kind: "stated",
      axis,
      text: `${keyDate.title} in ${days} day${days === 1 ? "" : "s"}`,
      evidence: [keyDate.date],
      supports: true,
      ...from,
    });
  }

  return { axis, value: Math.min(1, value), reasons };
}

// ── 5. Requirements ──────────────────────────────────────────────────────────

const PROVINCE_TERMS = CANADIAN_PROVINCES.map((p) => p.toLowerCase());

/** Whole-word test — "notebooks" contains "book", and that once matched 74 partners. */
function mentionsTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * Free-text vendor requirements — buy-local policies, supplier codes, insurance
 * minimums, certifications outside the catalogue.
 *
 * Phase 0 reads only what a controlled vocabulary can confirm: certification and
 * province names appearing in the prose. Everything else in those notes needs
 * the Phase 2 extraction pass, so when nothing recognisable is found this
 * returns `null` — "we could not read this" — rather than a misleading zero.
 */
export function requirementsFeature(subject: MatchProfile, candidate: MatchProfile): FeatureResult {
  const axis = "requirements" as const;
  const pair = sides(subject, candidate);
  if (!pair) return none(axis);

  const { buyer, supplier } = pair;
  const notes = buyer.requirementsNotes;
  if (!notes) return none(axis);

  const from = provenance(buyer, buyer.visibility.show_certifications);
  const signals: { hit: boolean; reason: MatchReason }[] = [];

  for (const cert of CERTIFICATION_NAMES) {
    if (!mentionsTerm(notes, cert)) continue;
    const hit = intersect([cert], supplier.certificationsHeld).length > 0;
    signals.push({
      hit,
      reason: {
        kind: "stated",
        axis,
        text: hit
          ? `Their requirements mention ${cert}, which you hold`
          : `Their requirements mention ${cert}`,
        evidence: [cert],
        supports: hit,
        ...from,
      },
    });
  }

  if (supplier.province && PROVINCE_TERMS.includes(supplier.province.toLowerCase())) {
    if (mentionsTerm(notes, supplier.province)) {
      signals.push({
        hit: true,
        reason: {
          kind: "stated",
          axis,
          text: `Their requirements name ${supplier.province}, where you're based`,
          evidence: [supplier.province],
          supports: true,
          ...from,
        },
      });
    }
  }

  if (signals.length === 0) return none(axis);

  const hits = signals.filter((s) => s.hit);
  return {
    axis,
    value: hits.length / signals.length,
    reasons: hits.length > 0 ? hits.map((s) => s.reason) : [signals[0].reason],
  };
}

// ── 6. Services ──────────────────────────────────────────────────────────────

/**
 * `store_services` — what a store runs in-house.
 *
 * Between members it is peer relevance: two stores running their own print shop
 * have a great deal to say to each other. Toward a partner it is demand — a store
 * doing engraving buys engraving inputs — and `STORE_SERVICES` doubles as the
 * class list under the "Store Services" department, so the join is exact.
 */
export function servicesFeature(subject: MatchProfile, candidate: MatchProfile): FeatureResult {
  const axis = "services" as const;

  if (subject.type === "member" && candidate.type === "member") {
    if (subject.storeServices.length === 0 || candidate.storeServices.length === 0) return none(axis);
    const shared = intersect(subject.storeServices, candidate.storeServices);
    const union = new Set(lower([...subject.storeServices, ...candidate.storeServices]));
    // Same rule as category: the audience is the subject, so only the
    // candidate's flag can withhold anything here.
    const from = provenance(candidate, candidate.visibility.show_store_services);
    return {
      axis,
      value: shared.length / union.size,
      reasons:
        shared.length > 0
          ? [
              {
                kind: "chosen",
                axis,
                text: `Also runs ${shared.join(", ")}`,
                evidence: shared,
                supports: true,
                ...from,
              },
            ]
          : [],
    };
  }

  const pair = sides(subject, candidate);
  if (!pair) return none(axis);
  const { buyer, supplier } = pair;
  if (buyer.storeServices.length === 0) return none(axis);

  const served = intersect(buyer.storeServices, supplier.classes);
  if (served.length === 0) return { axis, value: 0, reasons: [] };

  const from = provenance(buyer, buyer.visibility.show_store_services);
  return {
    axis,
    value: Math.min(1, served.length / buyer.storeServices.length),
    reasons: [
      {
        kind: "chosen",
        axis,
        text:
          subject.id === buyer.id
            ? `Supplies ${served.join(", ")}, which you run in-house`
            : `They run ${served.join(", ")} in-house — services you supply`,
        evidence: served,
        supports: true,
        ...from,
      },
    ],
  };
}

// ── 7. Cohort ────────────────────────────────────────────────────────────────

/**
 * Derived similarity from records rather than declarations — scale, institution
 * type, geography, and CANCOLL standing.
 *
 * ⚠️ CANCOLL is admin-managed and visibility-gated, not a self-declared
 * certification, which is why it sits here and not on the certification axis.
 */
export function cohortFeature(subject: MatchProfile, candidate: MatchProfile): FeatureResult {
  const axis = "cohort" as const;
  const parts: number[] = [];
  const reasons: MatchReason[] = [];

  if (subject.isCancoll && candidate.isCancoll) {
    parts.push(1);
    reasons.push({
      kind: "derived",
      axis,
      text: "Both CANCOLL",
      evidence: ["CANCOLL"],
      supports: true,
      sourceOrgId: null,
      sourceVisibility: "unset",
    });
  }

  const bothMembers = subject.type === "member" && candidate.type === "member";

  if (bothMembers && subject.scaleRange && candidate.scaleRange) {
    const same = subject.scaleRange === candidate.scaleRange;
    parts.push(same ? 1 : 0);
    if (same) {
      reasons.push({
        kind: "derived",
        axis,
        text: "Similar enrolment scale",
        evidence: [subject.scaleRange],
        supports: true,
        sourceOrgId: null,
      sourceVisibility: "unset",
      });
    }
  }

  if (bothMembers && subject.institutionType && candidate.institutionType) {
    const same = subject.institutionType.toLowerCase() === candidate.institutionType.toLowerCase();
    parts.push(same ? 1 : 0);
    if (same) {
      reasons.push({
        kind: "derived",
        axis,
        text: `Both ${subject.institutionType}`,
        evidence: [subject.institutionType],
        supports: true,
        sourceOrgId: null,
      sourceVisibility: "unset",
      });
    }
  }

  if (bothMembers && subject.province && candidate.province) {
    const same = subject.province.toLowerCase() === candidate.province.toLowerCase();
    parts.push(same ? 1 : 0);
    if (same) {
      reasons.push({
        kind: "derived",
        axis,
        text: `Both in ${subject.province}`,
        evidence: [subject.province],
        supports: true,
        sourceOrgId: null,
      sourceVisibility: "unset",
      });
    }
  }

  if (parts.length === 0) return none(axis);
  return { axis, value: parts.reduce((a, b) => a + b, 0) / parts.length, reasons };
}

// ── 8. Semantic ──────────────────────────────────────────────────────────────

export function cosineSimilarity(left: number[], right: number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  if (leftNorm === 0 || rightNorm === 0) return null;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/**
 * Embedding proximity between the two profile documents.
 *
 * ⚠️ Refuses any pair whose vectors came from different models. Voyage and a
 * local model occupy different spaces, and a cosine across them is noise wearing
 * the costume of a number — the one failure here that would be invisible.
 */
export function semanticFeature(subject: MatchProfile, candidate: MatchProfile): FeatureResult {
  const axis = "semantic" as const;
  if (!subject.embedding || !candidate.embedding) return none(axis);
  if (!subject.embeddingModel || subject.embeddingModel !== candidate.embeddingModel) return none(axis);

  const cosine = cosineSimilarity(subject.embedding, candidate.embedding);
  if (cosine === null) return none(axis);

  const value = Math.max(0, Math.min(1, cosine));
  return {
    axis,
    value,
    reasons:
      value >= 0.6
        ? [
            {
              kind: "semantic",
              axis,
              // Hedged on purpose — this is our inference, not their statement.
              text: "Their description reads close to what you're looking for",
              evidence: [`cosine ${value.toFixed(2)}`],
              supports: true,
              sourceOrgId: null,
      sourceVisibility: "unset",
            },
          ]
        : [],
  };
}

// ── 9. Behavioural ───────────────────────────────────────────────────────────

/**
 * Observed pull between these two orgs — profile views, catalogue clicks, badge
 * scans, sitting in each other's Circle space.
 *
 * This is the axis a taxonomy can never give you: it says "these two keep ending
 * up in the same room" without either of them having categorised anything.
 *
 * ⚠️ Explicit and implicit are NOT averaged. A declared refusal and a hundred
 * page views are different kinds of fact, and netting them into one number
 * destroys both. Explicit wins outright when present, and a negative explicit
 * signal drives the axis to zero — WITHOUT excluding the pair, because a score
 * may never be the reason two orgs do not meet. Enforcement reads the
 * declaration itself, elsewhere.
 */
export function behaviouralFeature(
  subject: MatchProfile,
  candidate: MatchProfile
): FeatureResult {
  const axis = "behavioural" as const;
  const edges = subject.revealedAffinities.filter((a) => a.orgId === candidate.id);
  if (edges.length === 0) return none(axis);

  const explicitNegative = edges.find((e) => e.stance === "explicit" && e.polarity === "negative");
  if (explicitNegative) {
    return {
      axis,
      value: 0,
      reasons: [
        {
          kind: "behavioural",
          axis,
          text: "Previously declined by this store",
          evidence: ["declared refusal"],
          supports: false,
          // The declaration belongs to the subject. Whether a partner may be told
          // it exists is not this layer's call — it records whose fact it is and
          // lets the consumer decide, the same as every other reason here.
          sourceOrgId: subject.id,
          sourceVisibility: "hidden",
        },
      ],
    };
  }

  const explicitPositive = edges.find((e) => e.stance === "explicit" && e.polarity === "positive");
  if (explicitPositive) {
    return {
      axis,
      value: Math.min(1, explicitPositive.weight),
      reasons: [
        {
          kind: "behavioural",
          axis,
          text: "Named as a preference",
          evidence: ["explicit preference"],
          supports: true,
          sourceOrgId: null,
      sourceVisibility: "unset",
        },
      ],
    };
  }

  const implicit = edges.find((e) => e.stance === "implicit" && e.polarity === "positive");
  if (!implicit) return none(axis);

  return {
    axis,
    value: Math.min(1, implicit.weight),
    reasons:
      implicit.weight >= 0.5
        ? [
            {
              kind: "behavioural",
              axis,
              // No count, no person — the aggregate framing is the text.
              text: "Repeated recent contact between these two",
              evidence: ["observed activity"],
              supports: true,
              sourceOrgId: null,
      sourceVisibility: "unset",
            },
          ]
        : [],
  };
}
