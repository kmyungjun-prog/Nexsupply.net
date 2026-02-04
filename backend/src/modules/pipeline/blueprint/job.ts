import { ActorRole, AuditActionType, ProjectStatus } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { AppError } from "../../../libs/errors.js";
import { assertNotVerified, onPipelineFailure } from "./safeguards.js";
import {
  createFactoryCandidateClaims,
  fetchFactoryCandidates,
  getProductOrCategoryFromProject,
} from "./rapidapi1688.js";
import {
  createDocumentExtractedClaims,
  OcrProvider,
  StubOcrProvider,
} from "./ocr.js";
import { runRuleEngine } from "../rules/index.js";
import { runAiExplain } from "../aiExplain/explain.js";
import { runAiCompare } from "../aiCompare/compare.js";

export type BlueprintPipelinePayload = {
  projectId: string;
  versionId: string;
  idempotencyKey: string;
};

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };

/**
 * Phase-C Lite: Blueprint pipeline job.
 * Triggered only when project.status === BLUEPRINT_RUNNING && isPaidBlueprint.
 * Payload: projectId, versionId, idempotencyKey.
 * Duplicate jobs ignored via idempotency (audit_action pipeline_run).
 * VERIFIED projects rejected.
 */
export async function runBlueprintPipeline(
  payload: BlueprintPipelinePayload,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
  ocrProvider: OcrProvider = new StubOcrProvider(),
): Promise<void> {
  const { projectId, versionId, idempotencyKey } = payload;
  const requestId = `pipeline:blueprint:${idempotencyKey}`;

  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });

  assertNotVerified(project.status);

  if (project.status !== ProjectStatus.BLUEPRINT_RUNNING || !project.isPaidBlueprint) {
    throw new AppError({
      statusCode: 409,
      code: "INVALID_TRANSITION",
      message: "Blueprint pipeline runs only when BLUEPRINT_RUNNING and isPaidBlueprint",
    });
  }

  const existingRun = await db.auditAction.findFirst({
    where: {
      projectId,
      idempotencyKey,
      actionType: AuditActionType.pipeline_run,
    },
  });
  if (existingRun) {
    log.info({ projectId, idempotencyKey }, "Blueprint pipeline already run (idempotent skip)");
    return;
  }

  try {
    const effectiveVersionId = versionId ?? project.activeVersionId ?? projectId;
    let factoriesCreated = 0;
    let documentsOcr = 0;

    const productOrCategory = await getProductOrCategoryFromProject(projectId);
    const candidates = await fetchFactoryCandidates(productOrCategory);
    if (candidates.length > 0) {
      await createFactoryCandidateClaims(projectId, effectiveVersionId, idempotencyKey, candidates, requestId);
      factoriesCreated = candidates.length;
    }

    const evidenceFiles = await db.evidenceFile.findMany({
      where: { projectId },
      select: { id: true, gcsPath: true },
    });
    for (const ev of evidenceFiles) {
      const result = await ocrProvider.extract(ev.gcsPath ?? ev.id);
      await createDocumentExtractedClaims(
        projectId,
        effectiveVersionId,
        ev.id,
        result,
        requestId,
        idempotencyKey,
      );
      documentsOcr += 1;
    }

    const resultSummary = { factories_created: factoriesCreated, documents_ocr: documentsOcr, errors: 0 };
    await db.auditAction.create({
      data: {
        projectId,
        actorId: ACTOR_SYSTEM.uid,
        actorRole: ACTOR_SYSTEM.role,
        actionType: AuditActionType.pipeline_run,
        note: JSON.stringify({ message: "Blueprint pipeline completed", result_summary: resultSummary }),
        requestId,
        idempotencyKey,
      },
    });
    log.info({ projectId, idempotencyKey, resultSummary }, "Blueprint pipeline completed");

    // Phase-C+: rule-based flags on factory candidates (append-only; do not stop pipeline on failure)
    await runRuleEngine(projectId, effectiveVersionId, idempotencyKey, requestId, log);
    // Phase-D: AI explanation of rule flags only (no decisions/rankings; skip on failure)
    await runAiExplain(projectId, effectiveVersionId, idempotencyKey, requestId, log);
    // Phase-D+: AI comparison of 2–5 candidates (explanation-only; do not stop pipeline on failure)
    try {
      await runAiCompare(projectId, effectiveVersionId, idempotencyKey, requestId, log);
    } catch (e) {
      log.error({ err: e, projectId }, "Phase-D+ failed (pipeline continues)");
    }
  } catch (err) {
    log.error({ err, projectId, idempotencyKey }, "Blueprint pipeline failed");
    const resultSummary = { factories_created: 0, documents_ocr: 0, errors: 1 };
    await db.auditAction.create({
      data: {
        projectId,
        actorId: ACTOR_SYSTEM.uid,
        actorRole: ACTOR_SYSTEM.role,
        actionType: AuditActionType.edit_note,
        note: JSON.stringify({
          message: `Pipeline failed: ${err instanceof Error ? err.message : String(err)}`,
          result_summary: resultSummary,
        }),
        requestId,
        idempotencyKey: `${idempotencyKey}:failed`,
      },
    });
    onPipelineFailure(projectId, String(err), log);
    throw err;
  }
}
