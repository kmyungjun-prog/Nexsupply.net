import type { FastifyInstance } from "fastify";
import { notifyPaymentRequest } from "./notifyPaymentRequest.js";
import { registerSlackRoutes } from "./routes.js";

/**
 * Phase-B: Slack-only integration. Isolated under /modules/slack.
 * TODO: Stripe replacement later — payment confirmation may move to Stripe webhooks; Slack remains for ops.
 */
export async function registerSlackModule(app: FastifyInstance): Promise<void> {
  await registerSlackRoutes(app);

  app.decorate("sendPaymentRequestNotification", async (projectId: string) => {
    await notifyPaymentRequest(projectId);
  });
}

declare module "fastify" {
  interface FastifyInstance {
    sendPaymentRequestNotification(projectId: string): Promise<void>;
  }
}
