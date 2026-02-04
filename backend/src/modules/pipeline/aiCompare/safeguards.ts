/**
 * Phase-D+ comparison safeguards. Reuse forbidden phrases from Phase-D.
 * Reject output containing recommendation/ranking language; discard and log.
 */

import { FORBIDDEN_PHRASES } from "../aiExplain/safeguards.js";

/** SOW: reject "recommend", "best", "better", "top", "should choose", "preferred", "rank", "ranking", "#1", "number one", "avoid", "do not use", "worse". */
export const COMPARISON_FORBIDDEN_PHRASES: readonly string[] = [
  ...FORBIDDEN_PHRASES,
  "better",
  "top",
  "rank",
  "avoid",
  "worse",
  "preferred",
];

export type ParsedComparison = {
  common_points: string[];
  differences: Array<{ factory_candidate_id: string; notes: string[] }>;
};

function isParsedComparison(obj: unknown): obj is ParsedComparison {
  if (obj == null || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.common_points) || !o.common_points.every((x) => typeof x === "string")) return false;
  if (!Array.isArray(o.differences)) return false;
  for (const d of o.differences) {
    if (d == null || typeof d !== "object") return false;
    const t = d as Record<string, unknown>;
    if (typeof t.factory_candidate_id !== "string") return false;
    if (!Array.isArray(t.notes) || !t.notes.every((x) => typeof x === "string")) return false;
  }
  return true;
}

/**
 * Parse AI response as JSON and validate structure.
 * Returns null if invalid or if text contains forbidden phrases.
 */
export function parseAndSanitizeComparison(raw: string | null | undefined): ParsedComparison | null {
  if (raw == null || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const lower = trimmed.toLowerCase();
  for (const phrase of COMPARISON_FORBIDDEN_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isParsedComparison(parsed)) return null;
  return parsed;
}
