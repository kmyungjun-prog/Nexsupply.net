import type { FastifyInstance } from "fastify";
import { registerProjectsRoutes } from "./routes.js";

export async function registerProjectsModule(app: FastifyInstance) {
  await registerProjectsRoutes(app);
}

