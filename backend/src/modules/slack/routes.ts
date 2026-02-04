import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { handleConfirmPayment } from "./handlers/confirmPayment.js";
import { handleConfirmPaymentCancel } from "./handlers/confirmPaymentCancel.js";
import { handleConfirmPaymentFirstClick } from "./handlers/confirmPaymentFirstClick.js";
import { handleNeedMoreDocs } from "./handlers/needMoreDocs.js";
import { handleReject } from "./handlers/reject.js";
import { verifySlackSignature } from "./verifySignature.js";

/** Capture raw body for Slack signature verification (must run before body parser). */
async function captureRawBody(request: FastifyRequest, _reply: unknown, payload: Readable): Promise<Readable> {
  const chunks: Buffer[] = [];
  for await (const chunk of payload) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  (request as FastifyRequest & { rawBody?: string }).rawBody = raw;
  return Readable.from([Buffer.from(raw, "utf8")]);
}

export async function registerSlackRoutes(app: FastifyInstance): Promise<void> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    app.log.warn("SLACK_SIGNING_SECRET not set; Slack routes will reject all requests.");
  }

  /** Slack Events API: url_verification + event_callback. Body JSON. */
  app.post(
    "/slack/events",
    {
      preParsing: captureRawBody,
      config: { rawBody: true },
    },
    async (req, reply) => {
      const rawBody = (req as { rawBody?: string }).rawBody ?? "";
      verifySlackSignature(rawBody, req.headers["x-slack-signature"] as string | undefined, req.headers["x-slack-request-timestamp"] as string | undefined);

      const body = req.body as { type?: string; challenge?: string };
      if (body.type === "url_verification") {
        return reply.send({ challenge: body.challenge });
      }
      if (body.type === "event_callback") {
        return reply.code(200).send();
      }
      return reply.code(200).send();
    },
  );

  /** Slack Interactivity: button payload. Body application/x-www-form-urlencoded with payload=... */
  app.post(
    "/slack/interactions",
    {
      preParsing: captureRawBody,
      config: { rawBody: true },
    },
    async (req, reply) => {
      const rawBody = (req as { rawBody?: string }).rawBody ?? "";
      verifySlackSignature(rawBody, req.headers["x-slack-signature"] as string | undefined, req.headers["x-slack-request-timestamp"] as string | undefined);

      const body = req.body as { payload?: string };
      let payload: {
        user?: { id: string };
        channel?: { id: string };
        message?: { ts: string };
        actions?: Array<{ action_id?: string; value?: string }>;
        container?: { channel_id?: string; message_ts?: string };
      };
      try {
        const raw = body.payload;
        payload = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
      } catch {
        return reply.code(400).send({ error: "Invalid payload" });
      }

      const action = payload.actions?.[0];
      const actionId = action?.action_id;
      const valueStr = action?.value ?? "{}";
      let value: { projectId?: string; idempotencyKey?: string };
      try {
        value = JSON.parse(valueStr);
      } catch {
        value = {};
      }
      const projectId = value.projectId;
      const requestId = (req as FastifyRequest & { id?: string }).id ?? "slack";

      if (!projectId) {
        return reply.code(400).send({ error: "Missing projectId in action value" });
      }

      const chId = payload.channel?.id ?? payload.container?.channel_id;
      const msgTs = payload.message?.ts ?? payload.container?.message_ts ?? "";
      const basePayload = {
        projectId,
        requestId,
        user: payload.user ?? { id: "unknown" },
        channel: chId ? { id: chId } : undefined,
        message: { ts: msgTs },
      };

      try {
        if (actionId === "confirm_payment") {
          const idempotencyKey = value.idempotencyKey;
          if (!idempotencyKey) {
            return reply.code(400).send({ error: "Confirm Payment requires idempotency_key in button value" });
          }
          await handleConfirmPaymentFirstClick({ ...basePayload, idempotencyKey });
        } else if (actionId === "confirm_payment_ack") {
          const idempotencyKey = value.idempotencyKey;
          if (!idempotencyKey) {
            return reply.code(400).send({ error: "Confirm Payment ack requires idempotency_key in button value" });
          }
          await handleConfirmPayment({ ...basePayload, idempotencyKey });
        } else if (actionId === "confirm_payment_cancel") {
          await handleConfirmPaymentCancel(basePayload);
        } else if (actionId === "reject") {
          await handleReject(basePayload);
        } else if (actionId === "need_more_docs") {
          await handleNeedMoreDocs(basePayload);
        } else {
          return reply.code(400).send({ error: "Unknown action_id" });
        }
        return reply.code(200).send();
      } catch (err: unknown) {
        req.log.error({ err, projectId, actionId }, "Slack button handler error");
        return reply.code(500).send({ error: "Handler failed" });
      }
    },
  );
}
