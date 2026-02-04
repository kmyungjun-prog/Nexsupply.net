import type { FastifyInstance } from "fastify";
import { registerInternalReviewRoutes } from "./routes.js";

export async function registerInternalReviewModule(app: FastifyInstance) {
  await registerInternalReviewRoutes(app);
}
