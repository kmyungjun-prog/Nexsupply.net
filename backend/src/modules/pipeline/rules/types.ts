/**
 * Phase-C+ rule engine types. Deterministic, auditable; no AI.
 * TODO: Phase-D AI-based enrichment; these flags remain as explainable signals.
 */

export type RuleFlag = {
  flag: string;
  reason: string;
};

/** Shape of factory_candidate claim value_json (from pipeline). */
export type FactoryCandidateValue = {
  factory_name?: string;
  platform?: string;
  source_url?: string;
  price_range?: { min?: number; max?: number; currency?: string };
  moq?: string;
  location?: string;
};

/** Input for a single candidate evaluation. */
export type CandidateWithId = {
  claimId: string;
  value: FactoryCandidateValue;
};

/** Context for price outlier: need all candidates' price_mid to compute median. */
export type RuleContext = {
  /** All factory_candidate claims in this run (for median etc.). */
  allCandidates: CandidateWithId[];
};

/** Output for one candidate: flags only; no ranking/scoring. */
export type RuleResult = {
  claimId: string;
  flags: RuleFlag[];
};
