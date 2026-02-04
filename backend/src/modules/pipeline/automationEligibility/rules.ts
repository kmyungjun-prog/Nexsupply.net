/**
 * Phase-H: Eligibility rules for repeat-SKU automation.
 * ALL conditions must match; otherwise eligible = false.
 * No automatic execution; evaluation only.
 */

export const ELIGIBILITY_REASONS = [
  "SAME_FACTORY",
  "PRICE_WITHIN_RANGE",
  "NO_CONSTRAINT_CHANGE",
] as const;

export const BLOCKED_BY_REASONS = [
  "PRICE_CHANGED",
  "MOQ_UNKNOWN",
  "FACTORY_CHANGED",
  "INCOTERM_CHANGED",
  "CURRENCY_CHANGED",
  "NO_PRIOR_VERIFIED_PROJECT",
  "NO_EXECUTION_RESULT",
] as const;

export type EligibilityResult = {
  eligible: boolean;
  reasons: string[];
  blocked_by: string[];
  based_on_execution_steps: string[];
};

/** Minimal context extracted from verified snapshot for comparison. */
export type SnapshotContext = {
  factory_id?: string | null;
  incoterm?: string | null;
  currency?: string | null;
  price?: number | null;
  moq?: number | null;
};

function extractContext(snapshot: unknown): SnapshotContext {
  const s = snapshot as Record<string, unknown> | null | undefined;
  if (s == null || typeof s !== "object") return {};
  const assumptions = s.assumptions as Record<string, unknown> | undefined;
  return {
    factory_id: (assumptions?.factory_id ?? s.factory_id) as string | undefined,
    incoterm: (assumptions?.incoterm ?? s.incoterm) as string | undefined,
    currency: (assumptions?.currency ?? s.currency) as string | undefined,
    price: typeof assumptions?.price === "number" ? assumptions.price : (s.price as number | undefined),
    moq: typeof assumptions?.moq === "number" ? assumptions.moq : (s.moq as number | undefined),
  };
}

const PRICE_DELTA_THRESHOLD = 0.03;

/**
 * Evaluate eligibility: ALL rules must pass. Safe by default (eligible = false unless proven).
 */
export function evaluateEligibility(
  currentSnapshot: unknown,
  currentExecutionSteps: string[],
  priorVerifiedSnapshot: unknown | null,
  hasExecutionResult: boolean,
): EligibilityResult {
  const reasons: string[] = [];
  const blocked_by: string[] = [];

  if (!hasExecutionResult) {
    blocked_by.push("NO_EXECUTION_RESULT");
    return { eligible: false, reasons: [], blocked_by, based_on_execution_steps: currentExecutionSteps };
  }

  if (priorVerifiedSnapshot == null) {
    blocked_by.push("NO_PRIOR_VERIFIED_PROJECT");
    return { eligible: false, reasons: [], blocked_by, based_on_execution_steps: currentExecutionSteps };
  }

  const current = extractContext(currentSnapshot);
  const prior = extractContext(priorVerifiedSnapshot);

  if (current.factory_id != null && prior.factory_id != null && current.factory_id === prior.factory_id) {
    reasons.push("SAME_FACTORY");
  } else {
    blocked_by.push("FACTORY_CHANGED");
  }

  if (current.incoterm != null && prior.incoterm != null && current.incoterm === prior.incoterm) {
    reasons.push("NO_CONSTRAINT_CHANGE");
  } else if (current.incoterm !== prior.incoterm) {
    blocked_by.push("INCOTERM_CHANGED");
  }

  if (current.currency != null && prior.currency != null && current.currency === prior.currency) {
    // currency unchanged
  } else if (current.currency !== prior.currency) {
    blocked_by.push("CURRENCY_CHANGED");
  }

  const curPrice = typeof current.price === "number" ? current.price : null;
  const priorPrice = typeof prior.price === "number" ? prior.price : null;
  if (curPrice != null && priorPrice != null && priorPrice > 0) {
    const delta = Math.abs(curPrice - priorPrice) / priorPrice;
    if (delta <= PRICE_DELTA_THRESHOLD) {
      reasons.push("PRICE_WITHIN_RANGE");
    } else {
      blocked_by.push("PRICE_CHANGED");
    }
  }

  const curMoq = current.moq;
  const priorMoq = prior.moq;
  if (curMoq != null && priorMoq != null && curMoq === priorMoq) {
    // MOQ unchanged
  } else if (curMoq == null || priorMoq == null) {
    blocked_by.push("MOQ_UNKNOWN");
  } else {
    blocked_by.push("NO_CONSTRAINT_CHANGE");
  }

  const eligible = blocked_by.length === 0;
  return {
    eligible,
    reasons: eligible ? [...reasons] : [],
    blocked_by,
    based_on_execution_steps: currentExecutionSteps,
  };
}
