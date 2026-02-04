/**
 * Phase-D+: AI comparison layer. Consumes multiple factory_candidate + factory_rule_flags; produces explanation-only comparison.
 * No rank, score, recommend, or judge.
 */

import { ActorRole, AuditActionType, ClaimType, ProjectStatus } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { appendClaim } from "../../claims/service.js";
import { FIELD_FACTORY_AI_COMPARISON, FIELD_FACTORY_CANDIDATE, FIELD_FACTORY_RULE_FLAGS } from "../blueprint/fieldKeys.js";
import { generateContent, getModelVersion } from "../aiExplain/vertexGemini.js";
import { getSystemPrompt, getUserPrompt } from "./prompt.js";
import { parseAndSanitizeComparison } from "./safeguards.js";

const ACTOR_SYSTEM = { uid: "system", role: ActorRole.system };
const SOURCE_REF = "ai_comparator:v1";
const MODEL_NAME = "gemini";
const MAX_COMPARISON_CANDIDATES = 5;
const MIN_COMPARISON_CANDIDATES = 2;

/**
 * Run Phase-D+ after Phase-D. Project must not be VERIFIED.
 * One comparison per run (2–5 candidates). On failure: log, skip; do not stop pipeline.
 */
export async function runAiCompare(
  projectId: string,
  versionId: string,
  idempotencyKey: string,
  requestId: string,
  log: { info: (o: unknown, msg: string) => void; error: (o: unknown, msg: string) => void },
): Promise<{ candidates_compared: number }> {
  try {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) {
      log.error({ projectId }, "Phase-D+: project not found");
      return { candidates_compared: 0 };
    }
    if (project.status === ProjectStatus.VERIFIED) {
      log.info({ projectId }, "Phase-D+: skip (VERIFIED)");
      return { candidates_compared: 0 };
    }
    if (project.status !== ProjectStatus.BLUEPRINT_RUNNING) {
      log.info({ projectId, status: project.status }, "Phase-D+: skip (not BLUEPRINT_RUNNING)");
      return { candidates_compared: 0 };
    }

    const effectiveVersionId = versionId ?? project.activeVersionId ?? projectId;
    const factoryClaims = await db.sourcingClaim.findMany({
      where: {
        projectId,
        versionId: effectiveVersionId,
        fieldKey: FIELD_FACTORY_CANDIDATE,
        claimType: ClaimType.HYPOTHESIS,
      },
      orderBy: { createdAt: "asc" },
      take: MAX_COMPARISON_CANDIDATES,
      select: { id: true, valueJson: true },
    });

    if (factoryClaims.length < MIN_COMPARISON_CANDIDATES) {
      log.info({ projectId, count: factoryClaims.length }, "Phase-D+: skip (fewer than 2 candidates)");
      await writeCompareAudit(projectId, idempotencyKey, requestId, 0, log);
      return { candidates_compared: 0 };
    }

    const ruleFlagsClaims = await db.sourcingClaim.findMany({
      where: {
        projectId,
        versionId: effectiveVersionId,
        fieldKey: FIELD_FACTORY_RULE_FLAGS,
        claimType: ClaimType.HYPOTHESIS,
      },
      select: { valueJson: true },
    });

    const referencedFlags: Record<string, string[]> = {};
    const candidatesForPrompt = factoryClaims.map((c) => {
      const flagsForCandidate = ruleFlagsClaims
        .filter((r) => (r.valueJson as { factory_candidate_id?: string })?.factory_candidate_id === c.id)
        .flatMap((r) => ((r.valueJson as { flags?: Array<{ flag: string }> })?.flags ?? []).map((f) => f.flag));
      referencedFlags[c.id] = [...new Set(flagsForCandidate)];
      return { id: c.id, value: c.valueJson };
    });

    const candidatesJson = JSON.stringify(candidatesForPrompt, null, 0);
    const flagsJson = JSON.stringify(
      factoryClaims.map((c) => ({ factory_candidate_id: c.id, flags: referencedFlags[c.id] ?? [] })),
      null,
      0,
    );

    const systemPrompt = getSystemPrompt();
    const userPrompt = getUserPrompt(candidatesJson, flagsJson);

    let raw: string;
    try {
      raw = await generateContent(systemPrompt, userPrompt, {
        maxOutputTokens: 400,
        temperature: 0.25,
      });
    } catch (err) {
      log.error({ err, projectId }, "Phase-D+: AI call failed");
      await db.auditAction.create({
        data: {
          projectId,
          actorId: ACTOR_SYSTEM.uid,
          actorRole: ACTOR_SYSTEM.role,
          actionType: AuditActionType.edit_note,
          note: JSON.stringify({
            message: `Phase-D+ AI comparison failed: ${err instanceof Error ? err.message : String(err)}`,
          }),
          requestId,
          idempotencyKey: `${idempotencyKey}:ai_compare:failed`,
        },
      });
      await writeCompareAudit(projectId, idempotencyKey, requestId, 0, log);
      return { candidates_compared: 0 };
    }

    const comparison = parseAndSanitizeComparison(raw);
    if (comparison == null) {
      log.info({ projectId }, "Phase-D+: output discarded (forbidden phrases or invalid JSON)");
      await db.auditAction.create({
        data: {
          projectId,
          actorId: ACTOR_SYSTEM.uid,
          actorRole: ACTOR_SYSTEM.role,
          actionType: AuditActionType.edit_note,
          note: JSON.stringify({ message: "Phase-D+ comparison discarded (recommendation/ranking language or invalid JSON)" }),
          requestId,
          idempotencyKey: `${idempotencyKey}:ai_compare:discard`,
        },
      });
      await writeCompareAudit(projectId, idempotencyKey, requestId, 0, log);
      return { candidates_compared: 0 };
    }

    const factoryCandidateIds = factoryClaims.map((c) => c.id);
    await appendClaim({
      projectId,
      actor: ACTOR_SYSTEM,
      fieldKey: FIELD_FACTORY_AI_COMPARISON,
      valueJson: {
        factory_candidate_ids: factoryCandidateIds,
        comparison: {
          common_points: comparison.common_points,
          differences: comparison.differences,
        },
        referenced_flags: referencedFlags,
        model: MODEL_NAME,
        model_version: getModelVersion(),
        generated_at: new Date().toISOString(),
      },
      claimType: ClaimType.HYPOTHESIS,
      sourceType: "model",
      sourceRef: SOURCE_REF,
      versionId: effectiveVersionId,
      idempotencyKey: `${idempotencyKey}:ai_compare`,
      requestId,
    });

    const n = factoryClaims.length;
    await writeCompareAudit(projectId, idempotencyKey, requestId, n, log);
    log.info({ projectId, candidates_compared: n }, "Phase-D+ AI comparison completed");
    return { candidates_compared: n };
  } catch (err) {
    log.error({ err, projectId }, "Phase-D+ failed");
    await db.auditAction.create({
      data: {
        projectId,
        actorId: ACTOR_SYSTEM.uid,
        actorRole: ACTOR_SYSTEM.role,
        actionType: AuditActionType.edit_note,
        note: JSON.stringify({
          message: `Phase-D+ failed: ${err instanceof Error ? err.message : String(err)}`,
          candidates_compared: 0,
        }),
        requestId,
        idempotencyKey: `${idempotencyKey}:ai_compare:failed`,
      },
    });
    return { candidates_compared: 0 };
  }
}

async function writeCompareAudit(
  projectId: string,
  idempotencyKey: string,
  requestId: string,
  candidatesCompared: number,
  log: { error: (o: unknown, msg: string) => void },
): Promise<void> {
  try {
    await db.auditAction.create({
      data: {
        projectId,
        actorId: ACTOR_SYSTEM.uid,
        actorRole: ACTOR_SYSTEM.role,
        actionType: AuditActionType.pipeline_run,
        note: JSON.stringify({
          message: "Phase-D+ AI comparison generated",
          candidates_compared: candidatesCompared,
        }),
        requestId,
        idempotencyKey: `${idempotencyKey}:ai_compare`,
      },
    });
  } catch (e) {
    log.error({ e, projectId }, "Phase-D+ audit write failed");
  }
}