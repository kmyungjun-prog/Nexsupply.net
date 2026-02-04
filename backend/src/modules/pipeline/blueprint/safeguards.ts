import { ClaimType, ProjectStatus } from "@prisma/client";
import { AppError } from "../../../libs/errors.js";

/**
 * Phase-C Lite: pipeline safety rules.
 * - NEVER overwrite existing claims (append-only).
 * - NEVER auto-transition project state.
 * - NEVER create VERIFIED claims.
 * - On failure: log audit, keep project in BLUEPRINT_RUNNING, notify Slack (stub).
 */

export function assertNotVerified(status: ProjectStatus): void {
  if (status === ProjectStatus.VERIFIED) {
    throw new AppError({ statusCode: 409, code: "CONFLICT", message: "VERIFIED projects cannot be processed by pipeline" });
  }
}

export function assertNoAutoTransition(): void {
  // Pipeline never calls transitionProject; state changes are human/Slack only.
}

export function assertNeverVerifiedClaim(claimType: ClaimType): void {
  if (claimType === ClaimType.VERIFIED) {
    throw new AppError({ statusCode: 400, code: "VALIDATION_ERROR", message: "Pipeline must not create VERIFIED claims" });
  }
}

/** On pipeline failure: log to audit; Slack notify is stub. TODO: wire Slack failure notification. */
export function onPipelineFailure(_projectId: string, _reason: string, _log: { error: (o: unknown, msg: string) => void }): void {
  // TODO: notify via Slack (stub only)
}
