import type { FastifyInstance } from "fastify";
import { registerClaimsRoutes } from "./routes.js";

export async function registerClaimsModule(app: FastifyInstance) {
  await registerClaimsRoutes(app);
}

