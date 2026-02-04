import { ActorRole, ProjectStatus } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { AppError } from "../../../libs/errors.js";
import { updateMessage } from "../slackClient.js";

/** Phase-B: Need more docs button. Writes audit_actions only; project state unchanged. Idempotent via slack:need_more_docs:${channel}:${ts}:${userId}. */
export async function handleNeedMoreDocs(payload: {
  projectId: string;
  requestId: string;
  user: { id: string };
  channel?: { id: string };
  message?: { ts: string };
}): Promise<void> {
  const project = await db.project.findUnique({ where: { id: payload.projectId } });
  if (!project) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
  if (project.status === ProjectStatus.VERIFIED) {
    throw new AppError({ statusCode: 409, code: "CONFLICT", message: "VERIFIED projects cannot be affected" });
  }

  const idempotencyKey = `slack:need_more_docs:${payload.channel?.id ?? "unknown"}:${payload.message?.ts ?? "unknown"}:${payload.user.id}`;
  const existing = await db.auditAction.findFirst({
    where: { projectId: payload.projectId, idempotencyKey },
  });
  if (existing) return; // duplicate button click

  await db.auditAction.create({
    data: {
      projectId: payload.projectId,
      actorId: `slack:${payload.user.id}`,
      actorRole: ActorRole.system,
      actionType: "request_more_docs",
      note: "Need more docs (Slack button)",
      requestId: payload.requestId,
      idempotencyKey,
    },
  });

  if (payload.channel?.id && payload.message?.ts) {
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Need more docs* — Project \`${payload.projectId}\`. Audit recorded.`,
        },
      },
    ];
    await updateMessage(payload.channel.id, payload.message.ts, blocks);
  }
}
