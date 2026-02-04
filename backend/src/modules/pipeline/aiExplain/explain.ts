/**
 * Phase-D: AI explanation layer. Consumes factory_candidate + factory_rule_flags; produces explanation-only claims.
 * No decisions, scores, rankings, or recommendations.
 */

import { ActorRole, AuditActionType, ClaimType, ProjectStatus } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { appendClaim } from "../../claims/service.js";
import { FIELD_FACTORY_AI_EXPLANATION, FIELD_FACTORY_CANDIDATE, FIELD_FACTORY_RULE_FLAGS } from "../blueprint/fieldKeys.js";
import { getSystemPrompt, getUserPrompt } from "./prompt.js";
import { assertProjectNotVerified } from "./safeguards.js";
import { sanitizeExplanation } from "./safeguards.js";
import { generateContent, getModelVersion } from "./vertexGemini.js";

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };
const SOURCE_REF = "ai_explainer:v1";
const MODEL_NAME = "gemini";

/**
 * Run Phase-D after rule engine. Project must not be VERIFIED.
 * On AI failure per candidate: log, skip. On audit write failure: log. Never throw.
 */
export async function runAiExplain(
  projectId: string,
  versionId: string,
  idempotencyKey: string,
  requestId: string,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
): Promise<{ factories_processed: number; explanations_created: number }> {
  try {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) {
      log.error({ projectId }, "Phase-D: project not found");
      return { factories_processed: 0, explanations_created: 0 };
    }
    assertProjectNotVerified(project);
    if (project.status !== ProjectStatus.BLUEPRINT_RUNNING) {
      log.info({ projectId, status: project.status }, "Phase-D: skip (not BLUEPRINT_RUNNING)");
      return { factories_processed: 0, explanations_created: 0 };
    }

    const effectiveVersionId = versionId ?? project.activeVersionId ?? projectId;
    const factoryClaims = await db.sourcingClaim.findMany({
      where: {
        projectId,
        versionId: effectiveVersionId,
        fieldKey: FIELD_FACTORY_CANDIDATE,
        claimType: ClaimType.HYPOTHESIS,
      },
      select: { id: true, valueJson: true },
    });

    const systemPrompt = getSystemPrompt();
    let explanationsCreated = 0;

    for (const fc of factoryClaims) {
      const ruleFlagsClaims = await db.sourcingClaim.findMany({
        where: {
          projectId,
          versionId: effectiveVersionId,
          fieldKey: FIELD_FACTORY_RULE_FLAGS,
          claimType: ClaimType.HYPOTHESIS,
        },
        select: { valueJson: true },
      });
      const forThisCandidate = ruleFlagsClaims.filter(
        (r) => (r.valueJson as { factory_candidate_id?: string })?.factory_candidate_id === fc.id,
      );
      if (forThisCandidate.length === 0) continue;

      const factoryCandidateJson = JSON.stringify(fc.valueJson, null, 0);
      const factoryRuleFlagsJson = JSON.stringify(
        forThisCandidate.map((r) => r.valueJson),
        null,
        0,
      );
      const userPrompt = getUserPrompt(factoryCandidateJson, factoryRuleFlagsJson);

      let explanation: string | null = null;
      try {
        const raw = await generateContent(systemPrompt, userPrompt, {
          maxOutputTokens: 300,
          temperature: 0.3,
        });
        explanation = sanitizeExplanation(raw);
      } catch (err) {
        log.error({ err, projectId, factoryCandidateId: fc.id }, "Phase-D: AI call failed, skipping candidate");
        await db.auditAction.create({
          data: {
            projectId,
            actorId: ACTOR_SYSTEM.uid,
            actorRole: ACTOR_SYSTEM.role,
            actionType: AuditActionType.edit_note,
            note: JSON.stringify({
              message: `Phase-D AI failed for factory_candidate ${fc.id}: ${err instanceof Error ? err.message : String(err)}`,
            }),
            requestId,
            idempotencyKey: `${idempotencyKey}:ai_explain:failed:${fc.id}`,
          },
        });
        continue;
      }

      if (explanation == null) {
        log.info({ projectId, factoryCandidateId: fc.id }, "Phase-D: output discarded (forbidden phrases)");
        await db.auditAction.create({
          data: {
            projectId,
            actorId: ACTOR_SYSTEM.uid,
            actorRole: ACTOR_SYSTEM.role,
            actionType: AuditActionType.edit_note,
            note: JSON.stringify({ message: "Phase-D: explanation discarded (recommendation/ranking language)" }),
            requestId,
            idempotencyKey: `${idempotencyKey}:ai_explain:discard:${fc.id}`,
          },
        });
        continue;
      }

      const referencedFlags = forThisCandidate.flatMap(
        (r) => ((r.valueJson as { flags?: Array<{ flag: string }> })?.flags ?? []).map((f) => f.flag),
      );
      const uniqueFlags = [...new Set(referencedFlags)];

      await appendClaim({
        projectId,
        actor: ACTOR_SYSTEM,
        fieldKey: FIELD_FACTORY_AI_EXPLANATION,
        valueJson: {
          factory_candidate_id: fc.id,
          explanation,
          referenced_flags: uniqueFlags,
          model: MODEL_NAME,
          model_version: getModelVersion(),
          generated_at: new Date().toISOString(),
        },
        claimType: ClaimType.HYPOTHESIS,
        sourceType: "model",
        sourceRef: SOURCE_REF,
        versionId: effectiveVersionId,
        idempotencyKey: `${idempotencyKey}:ai_explain:${fc.id}`,
        requestId,
      });
      explanationsCreated += 1;
    }

    await db.auditAction.create({
      data: {
        projectId,
        actorId: ACTOR_SYSTEM.uid,
        actorRole: ACTOR_SYSTEM.role,
        actionType: AuditActionType.pipeline_run,
        note: JSON.stringify({
          message: "Phase-D AI explanation generated",
          factories_processed: factoryClaims.length,
          explanations_created: explanationsCreated,
        }),
        requestId,
        idempotencyKey: `${idempotencyKey}:ai_explain`,
      },
    });
    log.info(
      { projectId, factories_processed: factoryClaims.length, explanations_created: explanationsCreated },
      "Phase-D AI explanation completed",
    );
    return { factories_processed: factoryClaims.length, explanations_created: explanationsCreated };
  } catch (err) {
    log.error({ err, projectId }, "Phase-D failed");
    await db.auditAction.create({
      data: {
        projectId,
        actorId: ACTOR_SYSTEM.uid,
        actorRole: ACTOR_SYSTEM.role,
        actionType: AuditActionType.edit_note,
        note: JSON.stringify({
          message: `Phase-D failed: ${err instanceof Error ? err.message : String(err)}`,
          factories_processed: 0,
          explanations_created: 0,
        }),
        requestId,
        idempotencyKey: `${idempotencyKey}:ai_explain:failed`,
      },
    });
    return { factories_processed: 0, explanations_created: 0 };
  }
}
