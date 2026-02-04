import type { FastifyRequest } from "fastify";
import { AppError } from "./errors.js";

/**
 * SOW 원칙: 상태 전이/Slack 버튼/큐 재시도는 idempotency key 필수.
 * - Phase-A에서는 별도의 idempotency 테이블을 만들지 않고,
 *   `project_status_events`의 (project_id, idempotency_key) UNIQUE로 중복을 방지한다.
 * - 추후(필요 시) "요청 단위" idempotency 저장소로 확장 가능. (TODO)
 */

export function getIdempotencyKey(req: FastifyRequest): string | undefined {
  const headerKey =
    (req.headers["idempotency-key"] as string | undefined) ??
    (req.headers["x-idempotency-key"] as string | undefined);
  const bodyKey = typeof (req.body as any)?.idempotencyKey === "string" ? (req.body as any).idempotencyKey : undefined;
  return headerKey ?? bodyKey;
}

export async function requireIdempotencyKey(req: FastifyRequest) {
  const key = getIdempotencyKey(req);
  if (!key) {
    throw new AppError({
      statusCode: 400,
      code: "IDEMPOTENCY_REQUIRED",
      message: "Idempotency key required (Idempotency-Key header or body.idempotencyKey)",
    });
  }
  (req as any).idempotencyKey = key;
}

declare module "fastify" {
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

