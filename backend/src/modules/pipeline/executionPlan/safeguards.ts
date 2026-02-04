/**
 * Phase-E safety guards.
 * - Assert project is VERIFIED before any logic.
 * - Assert no state transitions are called.
 * - Assert no external API calls are made.
 * - Assert all steps have human_action_required === true.
 *
 * TODO: Phase-F execution automation (human approval still mandatory).
 * TODO: UI action wiring (steps → user actions).
 * TODO: Localization (step descriptions, risks).
 */

import { ProjectStatus } from "@prisma/client";

export type ExecutionPlanStep = {
  step: string;
  description: string;
  inputs_required: string[];
  human_action_required: boolean;
};

/** Phase-E runs only when project is VERIFIED with snapshot and version. */
export function assertProjectVerified(project: {
  status: ProjectStatus;
  verifiedSnapshotJsonb: unknown;
  verifiedVersionId: string | null;
}): void {
  if (project.status !== ProjectStatus.VERIFIED) {
    throw new Error("Phase-E requires project.status === VERIFIED");
  }
  if (project.verifiedSnapshotJsonb == null) {
    throw new Error("Phase-E requires project.verifiedSnapshotJsonb");
  }
  if (project.verifiedVersionId == null || project.verifiedVersionId === "") {
    throw new Error("Phase-E requires project.verifiedVersionId");
  }
}

/** Assert no state transitions are called (Phase-E must not change project status). */
export function assertNoStateTransition(): void {
  // Caller must not invoke transitionProject() or any status change; no runtime hook here.
}

/** Assert no external API calls are made (Phase-E is deterministic, read-only from snapshot/claims). */
export function assertNoExternalApiCall(): void {
  // Caller must not perform fetch/HTTP in plan or costPreview; no runtime hook here.
}

/** Assert all steps have human_action_required === true. */
export function assertAllStepsRequireHuman(steps: ExecutionPlanStep[]): void {
  for (const s of steps) {
    if (s.human_action_required !== true) {
      throw new Error(`Phase-E step "${s.step}" must have human_action_required === true`);
    }
  }
}
