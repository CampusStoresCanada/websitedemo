/**
 * Conference v2 launch readiness — pure core.
 *
 * Walks the Describe → Package → Sell path and reports, per stage, what is
 * done / blocked / worth a warning. This is the SINGLE readiness model: the
 * Overview checklist UI renders it, and transitionConferenceStatus gates the
 * draft → registration_open transition on its blocking checks. The v1 bug —
 * a client-only preflight that disagreed with a separate server gate — cannot
 * recur because both read this one function.
 *
 * No server imports; unit-testable. The server loader that assembles the input
 * lives in lib/actions/conference-launch.ts.
 * See docs/CONFERENCE_V2_BLUEPRINT.md.
 */

export type ReadinessStatus = "ok" | "blocked" | "warning" | "info";
export type ReadinessStageKey = "describe" | "package" | "sell";

export type ReadinessCheck = {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  /** Which stage page fixes this (UI builds the href from the conference id). */
  fixStage?: ReadinessStageKey;
};

export type ReadinessStage = {
  key: ReadinessStageKey;
  label: string;
  checks: ReadinessCheck[];
  /** Worst status among the stage's checks (ok if all ok). */
  status: ReadinessStatus;
};

export type LaunchReadiness = {
  stages: ReadinessStage[];
  blockingCount: number;
  warningCount: number;
  /** True when no blocking checks remain — draft may go on sale. */
  canGoOnSale: boolean;
};

export type LaunchReadinessInput = {
  startDate: string | null;
  endDate: string | null;
  registrationOpenAt: string | null;
  registrationCloseAt: string | null;
  dayCount: number;
  taxRatePct: number | null;
  stripeTaxRateId: string | null;
  legalVersionCount: number;
  /** v3 Build catalog: total things, how many have open questions, how many are for sale. */
  v3ThingCount: number;
  v3OpenQuestionCount: number;
  v3ForSaleCount: number;
};

function parseUtc(value: string): Date {
  const normalized = value.endsWith("Z") || value.includes("+") ? value : value.replace(" ", "T") + "Z";
  return new Date(normalized);
}

function worstStatus(checks: ReadinessCheck[]): ReadinessStatus {
  if (checks.some((c) => c.status === "blocked")) return "blocked";
  if (checks.some((c) => c.status === "warning")) return "warning";
  if (checks.some((c) => c.status === "info")) return "info";
  return "ok";
}

function describeStage(input: LaunchReadinessInput): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const start = input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null;
  const end = input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : null;

  if (!input.startDate || !input.endDate) {
    checks.push({
      id: "dates",
      label: "Conference dates",
      status: "blocked",
      detail: "Set start and end dates.",
      fixStage: "describe",
    });
  } else if (start && end && end < start) {
    checks.push({
      id: "dates",
      label: "Conference dates",
      status: "blocked",
      detail: "End date is before the start date.",
      fixStage: "describe",
    });
  } else {
    checks.push({
      id: "dates",
      label: "Conference dates",
      status: "ok",
      detail: `${input.startDate} – ${input.endDate}`,
    });
  }

  const open = input.registrationOpenAt ? parseUtc(input.registrationOpenAt) : null;
  const close = input.registrationCloseAt ? parseUtc(input.registrationCloseAt) : null;
  if (!input.registrationOpenAt || !input.registrationCloseAt) {
    checks.push({
      id: "registration-window",
      label: "Registration window",
      status: "blocked",
      detail: "Set registration open and close times.",
      fixStage: "describe",
    });
  } else if (open && close && close <= open) {
    checks.push({
      id: "registration-window",
      label: "Registration window",
      status: "blocked",
      detail: "Registration closes before it opens.",
      fixStage: "describe",
    });
  } else {
    checks.push({ id: "registration-window", label: "Registration window", status: "ok", detail: "Set." });
    if (close && start && close > start) {
      checks.push({
        id: "registration-after-start",
        label: "Registration closes after the conference starts",
        status: "warning",
        detail: "Confirm this is intentional.",
        fixStage: "describe",
      });
    }
  }

  if (input.dayCount <= 0) {
    checks.push({
      id: "days",
      label: "Conference days",
      status: "blocked",
      detail: "No days defined. Set valid conference dates first.",
      fixStage: "describe",
    });
  } else {
    checks.push({ id: "days", label: "Conference days", status: "ok", detail: `${input.dayCount} day(s).` });
  }

  // v3 Build catalog: if the conference uses it, every thing must be defined.
  if (input.v3ThingCount > 0) {
    if (input.v3OpenQuestionCount > 0) {
      checks.push({
        id: "build-open-questions",
        label: "Build catalog open questions",
        status: "blocked",
        detail: `${input.v3OpenQuestionCount} thing(s) still need defining before going on sale.`,
        fixStage: "describe",
      });
    } else {
      checks.push({
        id: "build-open-questions",
        label: "Build catalog",
        status: "ok",
        detail: `${input.v3ThingCount} thing(s), all defined.`,
      });
    }
  }

  return checks;
}

function packageStage(input: LaunchReadinessInput): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  // The v3 Build catalog is the only catalog: something must be for sale.
  if (input.v3ForSaleCount === 0) {
    checks.push({
      id: "for-sale",
      label: "Things for sale",
      status: "blocked",
      detail: "Mark at least one thing for sale in Build before going on sale.",
      fixStage: "package",
    });
  } else {
    checks.push({
      id: "for-sale",
      label: "Things for sale",
      status: "ok",
      detail: `${input.v3ForSaleCount} thing(s) for sale.`,
    });
  }

  // Meeting scheduling (suites + per-day cadence) is a Fulfill-stage concern set
  // up in Build, not a go-on-sale gate — so it is no longer a launch blocker.

  return checks;
}

function sellStage(input: LaunchReadinessInput): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  if (input.legalVersionCount <= 0) {
    checks.push({
      id: "legal",
      label: "Legal documents",
      status: "blocked",
      detail: "Add at least one legal document version.",
      fixStage: "sell",
    });
  } else {
    checks.push({
      id: "legal",
      label: "Legal documents",
      status: "ok",
      detail: `${input.legalVersionCount} version(s).`,
    });
  }

  const hasRate = input.taxRatePct !== null && input.taxRatePct > 0;
  if (!hasRate) {
    checks.push({
      id: "tax",
      label: "Tax",
      status: "info",
      detail: "No tax rate set — confirm this conference is tax-exempt.",
      fixStage: "sell",
    });
  } else if (!input.stripeTaxRateId) {
    checks.push({
      id: "tax",
      label: "Tax",
      status: "warning",
      detail: "Tax rate set but no Stripe tax rate id linked — Stripe will not collect tax.",
      fixStage: "sell",
    });
  } else {
    checks.push({ id: "tax", label: "Tax", status: "ok", detail: `${input.taxRatePct}% (Stripe linked).` });
  }

  return checks;
}

export function computeLaunchReadiness(input: LaunchReadinessInput): LaunchReadiness {
  const baseStages: ReadinessStage[] = [
    { key: "describe", label: "Describe", checks: describeStage(input), status: "ok" },
    { key: "package", label: "Package", checks: packageStage(input), status: "ok" },
    { key: "sell", label: "Sell", checks: sellStage(input), status: "ok" },
  ];
  const stages: ReadinessStage[] = baseStages.map((stage) => ({
    ...stage,
    status: worstStatus(stage.checks),
  }));

  const allChecks = stages.flatMap((s) => s.checks);
  const blockingCount = allChecks.filter((c) => c.status === "blocked").length;
  const warningCount = allChecks.filter((c) => c.status === "warning").length;

  return {
    stages,
    blockingCount,
    warningCount,
    canGoOnSale: blockingCount === 0,
  };
}

/** Flat blocker messages — for the transition gate's error string. */
export function launchBlockers(readiness: LaunchReadiness): string[] {
  return readiness.stages
    .flatMap((s) => s.checks)
    .filter((c) => c.status === "blocked")
    .map((c) => `${c.label}: ${c.detail}`);
}

export type AnnounceReadiness = {
  canAnnounce: boolean;
  blockers: string[];
};

/**
 * The light gate for draft → announced: just "do we know when this is."
 * Deliberately does NOT check registration window, the Build catalog, things
 * for sale, or legal docs — those are sell-readiness, not
 * tell-people-it-exists readiness, and shouldn't block getting the word out.
 */
export function computeAnnounceReadiness(
  input: Pick<LaunchReadinessInput, "startDate" | "endDate">
): AnnounceReadiness {
  const blockers: string[] = [];
  const start = input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null;
  const end = input.endDate ? new Date(`${input.endDate}T00:00:00Z`) : null;

  if (!input.startDate || !input.endDate) {
    blockers.push("Conference dates: set start and end dates.");
  } else if (start && end && end < start) {
    blockers.push("Conference dates: end date is before the start date.");
  }

  return { canAnnounce: blockers.length === 0, blockers };
}
