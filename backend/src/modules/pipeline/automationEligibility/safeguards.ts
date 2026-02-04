/**
 * Phase-H safety guards. Repeat-SKU eligibility evaluation only.
 * No automatic execution; no state changes; append-only.
 */

import { ProjectStatus } from "@prisma/client";

/** Phase-H runs only after project is VERIFIED with snapshot and version. */
export function assertProjectVerified(project: {
  status: ProjectStatus;
  verifiedSnapshotJsonb: unknown;
  verifiedVersionId: string | null;
}): void {
  if (project.status !== ProjectStatus.VERIFIED) {
    throw new Error("Phase-H requires project.status === VERIFIED");
  }
  if (project.verifiedSnapshotJsonb == null) {
    throw new Error("Phase-H requires project.verifiedSnapshotJsonb");
  }
  if (project.verifiedVersionId == null || project.verifiedVersionId === "") {
    throw new Error("Phase-H requires project.verifiedVersionId");
  }
}

/** At least one execution_action_result (Phase-G) must exist. */
export function assertExecutionResultExists(count: number): void {
  if (count < 1) {
    throw new Error("Phase-H requires at least one execution_action_result (Phase-G)");
  }
}
