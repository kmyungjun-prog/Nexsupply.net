import { ActorRole, EventSource, ProjectStatus } from "@prisma/client";
import { db } from "../../../libs/db.js";
import { AppError } from "../../../libs/errors.js";
import { jobs } from "../../../libs/jobs.js";
import { transitionProject } from "../../stateMachine/service.js";
import { updateMessage } from "../slackClient.js";

/** Phase-B: Confirm Payment button. Idempotency via key in button value; transition WAITING_PAYMENT → BLUEPRINT_RUNNING; is_paid_blueprint = true; enqueue blueprint job (stub). */
export async function handleConfirmPayment(payload: {
  projectId: string;
  idempotencyKey: string;
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
  if (project.status !== ProjectStatus.WAITING_PAYMENT) {
    throw new AppError({ statusCode: 409, code: "INVALID_TRANSITION", message: "Project is not WAITING_PAYMENT" });
  }

  const actor = { uid: `slack:${payload.user.id}`, role: ActorRole.system as ActorRole };

  const result = await transitionProject({
    projectId: payload.projectId,
    toStatus: ProjectStatus.BLUEPRINT_RUNNING,
    reason: "Slack Confirm Payment",
    source: EventSource.slack,
    actor,
    idempotencyKey: payload.idempotencyKey,
    requestId: payload.requestId,
    setIsPaidBlueprint: true,
  });

  const proj = result.project;
  if (proj && !result.replayed) {
    // Job payload includes versionId for worker idempotency (Phase-C).
    await jobs.enqueue({
      name: "blueprint_pipeline",
      payload: {
        projectId: payload.projectId,
        versionId: proj.activeVersionId ?? proj.id,
      },
      idempotencyKey: payload.idempotencyKey,
    });
  }

  if (payload.channel?.id && payload.message?.ts) {
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Payment confirmed* — Project \`${payload.projectId}\` → BLUEPRINT_RUNNING. Blueprint pipeline enqueued.`,
        },
      },
    ];
    await updateMessage(payload.channel.id, payload.message.ts, blocks);
  }
}
