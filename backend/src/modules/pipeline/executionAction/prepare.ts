/**
 * Phase-F: Prepare execution artifacts per approved step.
 * Read-only from execution_plan and approval audit.
 * Generates drafts/templates only; NEVER sends or performs irreversible actions.
 *
 * TODO: Phase-G (sending / execution); human send remains mandatory.
 * TODO: UI wiring (artifacts → user send / confirm).
 * TODO: Localization (templates, question lists).
 */

import { ActorRole, AuditActionType, ClaimType } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { appendClaim } from "../../claims/service.js";
import { FIELD_EXECUTION_ACTION } from "../blueprint/fieldKeys.js";

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };
const SOURCE_REF = "execution_actor:v1";

export type ExecutionActionValueJson = {
  step: string;
  status: "prepared";
  artifacts: {
    email_draft: string | null;
    message_template: string | null;
    attachments: string[];
  };
  requires_human_send: true;
  generated_at: string;
};

/** Deterministic artifact for a step: draft/template only; no send. */
function buildArtifactsForStep(step: string): ExecutionActionValueJson["artifacts"] {
  switch (step) {
    case "sample_request":
      return {
        email_draft: null,
        message_template:
          "Request pre-production sample from the verified factory. Please provide shipping address and sample quantity.",
        attachments: [],
      };
    case "price_confirmation":
      return {
        email_draft: null,
        message_template:
          "Confirm final unit price, MOQ, and payment terms with the verified factory.",
        attachments: [],
      };
    case "production_lead_time":
      return {
        email_draft: null,
        message_template:
          "Confirm production timeline and shipping window with the verified factory.",
        attachments: [],
      };
    default:
      return {
        email_draft: null,
        message_template: `Execute step: ${step}. Human action required.`,
        attachments: [],
      };
  }
}

/**
 * For each approved step, generate deterministic artifacts and append execution_action claim.
 * Step failures: write audit edit_note, continue with other steps.
 * Idempotency: per-step idempotency_key so re-run does not duplicate.
 */
export async function prepareExecutionActions(
  projectId: string,
  verifiedVersionId: string,
  approvedSteps: string[],
  idempotencyKey: string,
  requestId: string,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
): Promise<{ stepsPrepared: number; errors: string[] }> {
  let stepsPrepared = 0;
  const errors: string[] = [];

  for (const step of approvedSteps) {
    const stepIdempotencyKey = `${idempotencyKey}:execution_action:${step}`;
    try {
      const valueJson: ExecutionActionValueJson = {
        step,
        status: "prepared",
        artifacts: buildArtifactsForStep(step),
        requires_human_send: true,
        generated_at: new Date().toISOString(),
      };

      await appendClaim({
        projectId,
        actor: ACTOR_SYSTEM,
        fieldKey: FIELD_EXECUTION_ACTION,
        valueJson,
        claimType: ClaimType.HYPOTHESIS,
        sourceType: "system",
        sourceRef: SOURCE_REF,
        versionId: verifiedVersionId,
        idempotencyKey: stepIdempotencyKey,
        requestId,
        allowWhenVerified: true,
      });

      stepsPrepared += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`step ${step}: ${msg}`);
      log.error({ err, projectId, step }, "Phase-F step failed");
      await db.auditAction.create({
        data: {
          projectId,
          actorId: ACTOR_SYSTEM.uid,
          actorRole: ACTOR_SYSTEM.role,
          actionType: AuditActionType.edit_note,
          note: JSON.stringify({ message: `Phase-F step failed: ${step}`, error: msg }),
          requestId,
          idempotencyKey: `${idempotencyKey}:execution_action:${step}:failed`,
        },
      });
    }
  }

  return { stepsPrepared, errors };
}
