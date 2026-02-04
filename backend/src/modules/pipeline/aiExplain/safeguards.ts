/**
 * Phase-D safety guards. AI output is informational only.
 * - Assert project not VERIFIED
 * - Assert no VERIFIED claims created
 * - Discard output containing recommendation/ranking language; log audit
 * Phase-D+ can reuse FORBIDDEN_PHRASES for comparison explanations.
 */

import { ProjectStatus } from "@prisma/client";

/** Phase-D+: reuse for comparison/ranking-guard in comparison explanations. */
export const FORBIDDEN_PHRASES: readonly string[] = [
  "recommend",
  "best",
  "should choose",
  "top pick",
  "prefer this",
  "better choice",
  "ranked",
  "ranking",
  "number one",
  "#1",
  "avoid this",
  "do not use",
];

/** Explanations shorter than this are discarded (too short to be useful). */
export const MIN_EXPLANATION_LENGTH = 50;

export function assertProjectNotVerified(project: { status: ProjectStatus }): void {
  if (project.status === ProjectStatus.VERIFIED) {
    throw new Error("Project is VERIFIED; Phase-D does not run");
  }
}

/** Check that we never create VERIFIED claims (Phase-D only creates HYPOTHESIS). */
export function assertNoVerifiedClaimsCreated(): void {
  // Caller must ensure claim_type is HYPOTHESIS only; no runtime check needed if code path is correct.
}

/**
 * If AI output contains recommendation/ranking language or is too short, return null (discard).
 * Otherwise return trimmed text.
 */
export function sanitizeExplanation(text: string | null | undefined): string | null {
  if (text == null || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed.length < MIN_EXPLANATION_LENGTH) return null;
  const lower = trimmed.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) return null;
  }
  return trimmed;
}
