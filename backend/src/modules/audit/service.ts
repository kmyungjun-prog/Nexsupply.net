import { db } from "../../libs/db.js";

export async function getAuditLog(projectId: string) {
  const [actions, transitions] = await Promise.all([
    db.auditAction.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    }),
    db.projectStatusEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { actions, transitions };
}

