import type { FastifyInstance } from "fastify";
import { authenticate } from "../../libs/auth.js";
import { getProjectOrThrow, assertProjectAccess } from "../projects/service.js";
import { getAuditLog } from "./service.js";

export async function registerAuditRoutes(app: FastifyInstance) {
  app.get(
    "/projects/:id/audit-log",
    {
      preHandler: [authenticate],
      schema: {
        params: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
      },
    },
    async (req) => {
      const actor = { uid: req.auth!.uid, role: req.auth!.role as any };
      const { id } = req.params as { id: string };
      const project = await getProjectOrThrow(id);
      assertProjectAccess(project, actor);
      const log = await getAuditLog(project.id);
      return { projectId: project.id, ...log };
    },
  );
}

