import Fastify from "fastify";
import { createInProcessJobQueue, setJobQueue } from "./libs/jobs.js";
import { registerAuth } from "./libs/auth.js";
import { setErrorHandler } from "./libs/errors.js";
import { runBlueprintPipeline } from "./modules/pipeline/blueprint/job.js";
import { registerProjectsModule } from "./modules/projects/index.js";
import { registerClaimsModule } from "./modules/claims/index.js";
import { registerAuditModule } from "./modules/audit/index.js";
import { registerSlackModule } from "./modules/slack/index.js";
import { registerInternalReviewModule } from "./modules/internalReview/index.js";

export async function buildApp() {
  /**
   * Fastify 선택 이유 (SOW: Express 또는 Fastify):
   * - JSON schema 기반 검증/타이핑, 훅(preHandler) 구조가 명확해서
   *   "상태 전이 단일 함수 + idempotency 강제" 같은 불변 규칙을 적용하기 쉽다.
   * - 성능/로깅(기본 pino)도 프로덕션 구조에 적합.
   */
  const app = Fastify({
    logger: true,
    trustProxy: true,
  });

  setErrorHandler(app);
  await registerAuth(app);

  const queue = createInProcessJobQueue({
    blueprint_pipeline: async (payload) => {
      const p = payload as { projectId: string; versionId?: string; idempotencyKey?: string };
      await runBlueprintPipeline(
        {
          projectId: p.projectId,
          versionId: p.versionId ?? p.projectId,
          idempotencyKey: p.idempotencyKey ?? p.projectId,
        },
        app.log,
      );
    },
  });
  setJobQueue(queue);

  // Health
  app.get("/healthz", async (req) => ({ ok: true, requestId: req.id }));

  // Modules (Slack before projects so sendPaymentRequestNotification is available on transition)
  await registerSlackModule(app);
  await registerProjectsModule(app);
  await registerClaimsModule(app);
  await registerAuditModule(app);
  await registerInternalReviewModule(app);

  return app;
}

