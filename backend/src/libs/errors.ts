import type { FastifyReply, FastifyRequest } from "fastify";

export type AppErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "IDEMPOTENCY_REQUIRED"
  | "INVALID_TRANSITION"
  | "IMMUTABLE_CLAIM"
  | "CONFLICT"
  | "INTERNAL";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: AppErrorCode;
  public readonly details?: unknown;

  constructor(opts: { statusCode: number; code: AppErrorCode; message: string; details?: unknown }) {
    super(opts.message);
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export function assertUnreachable(x: never): never {
  throw new AppError({ statusCode: 500, code: "INTERNAL", message: `Unreachable: ${String(x)}` });
}

export function setErrorHandler(fastify: { setErrorHandler: any }) {
  fastify.setErrorHandler((err: any, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = req.id;

    // Fastify schema validation error
    if (err?.validation) {
      reply.status(400).send({
        requestId,
        error: { code: "VALIDATION_ERROR", message: "Invalid request", details: err.validation },
      });
      return;
    }

    if (err instanceof AppError) {
      reply.status(err.statusCode).send({
        requestId,
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }

    req.log.error({ err }, "Unhandled error");
    reply.status(500).send({
      requestId,
      error: { code: "INTERNAL", message: "Internal server error" },
    });
  });
}

