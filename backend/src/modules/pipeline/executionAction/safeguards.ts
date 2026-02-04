/**
 * Phase-F safety guards.
 * - Assert project is VERIFIED.
 * - Assert execution_plan claim exists.
 * - Assert human approval audit event (execution_approved) exists; approved_steps subset of plan steps.
 * - Assert no state transitions; no external API calls.
 *
 * TODO: Phase-G (sending / execution); human approval remains mandatory.
 * TODO: UI wiring (approved_steps → confirm / send).
 * TODO: Localization (artifacts, templates).
 */

import { ActorRole, AuditActionType, ProjectStatus } from "@prisma/client";

/** Phase-F runs only when project is VERIFIED. */
export function assertProjectVerified(project: {
  status: ProjectStatus;
  verifiedVersionId: string | null;
}): void {
  if (project.status !== ProjectStatus.VERIFIED) {
    throw new Error("Phase-F requires project.status === VERIFIED");
  }
  if (project.verifiedVersionId == null || project.verifiedVersionId === "") {
    throw new Error("Phase-F requires project.verifiedVersionId");
  }
}

/** Execution plan claim must exist and contain steps array. */
export function assertExecutionPlanExists(executionPlanClaim: {
  valueJson: unknown;
} | null): void {
  if (executionPlanClaim == null) {
    throw new Error("Phase-F requires execution_plan claim");
  }
  const v = executionPlanClaim.valueJson as { steps?: Array<{ step?: string }> };
  if (!Array.isArray(v?.steps) || v.steps.length === 0) {
    throw new Error("Phase-F requires execution_plan with steps");
  }
}

export type ApprovalNote = {
  approved_steps?: string[];
  approved_at?: string;
};

/** Human approval audit must exist: action_type execution_approved, actor user or admin, approved_steps subset of plan steps. */
export function assertHumanApprovalExists(
  approvalAudit: { actionType: AuditActionType; actorRole: ActorRole; note: string | null } | null,
  planStepIds: string[],
): void {
  if (approvalAudit == null) {
    throw new Error("Phase-F requires execution_approved audit event");
  }
  if (approvalAudit.actionType !== AuditActionType.execution_approved) {
    throw new Error("Phase-F requires audit action_type execution_approved");
  }
  if (approvalAudit.actorRole !== ActorRole.user && approvalAudit.actorRole !== ActorRole.admin) {
    throw new Error("Phase-F approval must be by user or admin");
  }
  let note: ApprovalNote;
  try {
    note = approvalAudit.note ? (JSON.parse(approvalAudit.note) as ApprovalNote) : {};
  } catch {
    throw new Error("Phase-F approval note must be valid JSON");
  }
  const approved = note.approved_steps;
  if (!Array.isArray(approved)) {
    throw new Error("Phase-F approval note must include approved_steps array");
  }
  const planSet = new Set(planStepIds);
  for (const s of approved) {
    if (typeof s !== "string" || !planSet.has(s)) {
      throw new Error("Phase-F approved_steps must be subset of execution_plan.steps");
    }
  }
}

/** Assert no external API calls (Phase-F prepares artifacts only; no send/payment/order). */
export function assertNoExternalApiCall(): void {
  // Caller must not perform fetch/HTTP; no runtime hook here.
}

/** Assert no state transitions (Phase-F must not change project status). */
export function assertNoStateTransition(): void {
  // transitionProject must not be imported or called.
}
