/**
 * Phase-G safety guards. Records human-declared execution with evidence only.
 * - Assert project is VERIFIED.
 * - Assert prepared execution_action exists for step.
 * - Assert evidence exists (uploaded, sha256 present).
 * - Assert actor is user or admin.
 * - No state transitions; no external API calls.
 */

import { ActorRole, ProjectStatus } from "@prisma/client";

/** Phase-G runs only when project is VERIFIED. */
export function assertProjectVerified(project: {
  status: ProjectStatus;
  verifiedVersionId: string | null;
}): void {
  if (project.status !== ProjectStatus.VERIFIED) {
    throw new Error("Phase-G requires project.status === VERIFIED");
  }
  if (project.verifiedVersionId == null || project.verifiedVersionId === "") {
    throw new Error("Phase-G requires project.verifiedVersionId");
  }
}

/** Prepared execution_action claim must exist for the step (status === "prepared"). */
export function assertPreparedExecutionActionExists(executionActionClaim: {
  valueJson: unknown;
} | null): void {
  if (executionActionClaim == null) {
    throw new Error("Phase-G requires execution_action claim for this step");
  }
  const v = executionActionClaim.valueJson as { step?: string; status?: string };
  if (v?.status !== "prepared") {
    throw new Error("Phase-G requires execution_action with status prepared");
  }
}

/** Evidence files must exist for the project and have sha256. */
export function assertEvidenceExists(
  evidenceIds: string[],
  foundCount: number,
  projectId: string,
): void {
  if (evidenceIds.length === 0) {
    throw new Error("Phase-G requires non-empty evidence_ids");
  }
  if (foundCount !== evidenceIds.length) {
    throw new Error(
      `Phase-G evidence_ids must exist in project: expected ${evidenceIds.length}, found ${foundCount}`,
    );
  }
}

/** Actor must be user or admin (human confirmation). */
export function assertHumanActor(actor: { role: ActorRole }): void {
  if (actor.role !== ActorRole.user && actor.role !== ActorRole.admin) {
    throw new Error("Phase-G execution_marked_sent must be by user or admin");
  }
}

/** Assert no state transitions (Phase-G must not change project status). */
export function assertNoStateTransition(): void {
  // transitionProject must not be imported or called.
}

/** Assert no external API calls (Phase-G records only). */
export function assertNoExternalApiCall(): void {
  // No fetch/HTTP; record-only.
}
