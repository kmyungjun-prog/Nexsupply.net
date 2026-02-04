/**
 * Phase-C+ deterministic rules. Pure functions; no AI.
 * TODO: User-configurable MOQ threshold (e.g. per project or org).
 * TODO: Region policy per project (allowedRegions from project settings).
 * TODO: Phase-D AI-based enrichment; these rules remain as explainable baseline.
 */

import type { CandidateWithId, FactoryCandidateValue, RuleContext, RuleFlag, RuleResult } from "./types.js";
import { getPriceMid } from "./priceUtils.js";

/** Default MOQ threshold; flag if candidate MOQ exceeds this. */
const DEFAULT_EXPECTED_MOQ = 1000;

/** Allowed region codes for REGION_MISMATCH. TODO: make per-project configurable. */
const ALLOWED_REGIONS = ["CN", "VN", "TH"];

/** Price outlier bounds: flag if price_mid < median * LOW_RATIO or > median * HIGH_RATIO. */
const LOW_RATIO = 0.6;
const HIGH_RATIO = 1.4;

function parseMoq(moq: string | undefined): number | null {
  if (moq == null || String(moq).trim() === "") return null;
  const n = Number(String(moq).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Rule A: MOQ presence / threshold.
 * MOQ_MISSING if moq missing; MOQ_HIGH if moq > expectedMOQ.
 */
export function ruleMoq(
  value: FactoryCandidateValue,
  expectedMOQ: number = DEFAULT_EXPECTED_MOQ,
): RuleFlag[] {
  const flags: RuleFlag[] = [];
  const moq = parseMoq(value.moq);
  if (moq === null) {
    flags.push({ flag: "MOQ_MISSING", reason: "MOQ is missing" });
    return flags;
  }
  if (moq > expectedMOQ) {
    flags.push({
      flag: "MOQ_HIGH",
      reason: `MOQ ${moq} exceeds expected threshold ${expectedMOQ}`,
    });
  }
  return flags;
}

/**
 * Rule B: Region match.
 * REGION_MISMATCH if location does not contain any allowed region code (e.g. CN, VN, TH).
 */
export function ruleRegion(
  value: FactoryCandidateValue,
  allowedRegions: string[] = ALLOWED_REGIONS,
): RuleFlag[] {
  const flags: RuleFlag[] = [];
  const loc = value.location?.trim();
  if (loc == null || loc === "") return flags;
  const upper = loc.toUpperCase();
  const match = allowedRegions.some((r) => upper.includes(r.toUpperCase()));
  if (!match) {
    flags.push({
      flag: "REGION_MISMATCH",
      reason: `Location "${loc}" not in allowed regions [${allowedRegions.join(", ")}]`,
    });
  }
  return flags;
}

function median(numbers: number[]): number | null {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Rule C: Price outlier (deterministic).
 * PRICE_OUTLIER if price_mid < median * 0.6 or > median * 1.4.
 */
export function rulePriceOutlier(
  value: FactoryCandidateValue,
  context: RuleContext,
): RuleFlag[] {
  const flags: RuleFlag[] = [];
  const priceMid = getPriceMid(value.price_range);
  if (priceMid == null) return flags;
  const allMids = context.allCandidates
    .map((c) => getPriceMid(c.value.price_range))
    .filter((n): n is number => n != null);
  const med = median(allMids);
  if (med == null || med <= 0) return flags;
  if (priceMid < med * LOW_RATIO) {
    flags.push({
      flag: "PRICE_OUTLIER",
      reason: `Price mid ${priceMid} is below median ${med} * ${LOW_RATIO} (${med * LOW_RATIO})`,
    });
  } else if (priceMid > med * HIGH_RATIO) {
    flags.push({
      flag: "PRICE_OUTLIER",
      reason: `Price mid ${priceMid} exceeds median ${med} * ${HIGH_RATIO} (${med * HIGH_RATIO})`,
    });
  }
  return flags;
}

/** Evaluate one candidate with full context. Returns flags only; no ranking. */
export function evaluateCandidate(
  candidate: CandidateWithId,
  context: RuleContext,
  expectedMOQ: number = DEFAULT_EXPECTED_MOQ,
  allowedRegions: string[] = ALLOWED_REGIONS,
): RuleResult {
  const flags: RuleFlag[] = [];
  flags.push(...ruleMoq(candidate.value, expectedMOQ));
  flags.push(...ruleRegion(candidate.value, allowedRegions));
  flags.push(...rulePriceOutlier(candidate.value, context));
  return { claimId: candidate.claimId, flags };
}

/** Evaluate all candidates. Deterministic, testable. */
export function evaluateAll(
  candidates: CandidateWithId[],
  expectedMOQ: number = DEFAULT_EXPECTED_MOQ,
  allowedRegions: string[] = ALLOWED_REGIONS,
): RuleResult[] {
  const context: RuleContext = { allCandidates: candidates };
  return candidates.map((c) => evaluateCandidate(c, context, expectedMOQ, allowedRegions));
}
