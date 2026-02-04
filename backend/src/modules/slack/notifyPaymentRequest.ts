import { randomUUID } from "node:crypto";
import { ProjectStatus } from "@prisma/client";
import { db } from "../../libs/db.js";
import { AppError } from "../../libs/errors.js";
import { postMessage } from "./slackClient.js";

/** Phase-B: send payment request notification when project enters WAITING_PAYMENT. Buttons: Confirm Payment, Reject, Need more docs. */
export async function notifyPaymentRequest(projectId: string): Promise<void> {
  const channel = process.env.SLACK_PAYMENT_CHANNEL_ID;
  const token = process.env.SLACK_BOT_TOKEN;
  if (!channel || !token) {
    return; // Slack not configured; skip without failing (e.g. dev)
  }

  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Project not found" });
  if (project.status !== ProjectStatus.WAITING_PAYMENT) {
    return; // idempotent: only notify when in WAITING_PAYMENT
  }

  const idempotencyKey = randomUUID();
  const confirmValue = JSON.stringify({ projectId, idempotencyKey });
  const rejectValue = JSON.stringify({ projectId });
  const needMoreValue = JSON.stringify({ projectId });

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Payment request* — Project \`${projectId}\` is waiting for payment confirmation.`,
      },
    },
    {
      type: "actions",
      block_id: "payment_actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "Confirm Payment" }, action_id: "confirm_payment", value: confirmValue },
        { type: "button", text: { type: "plain_text", text: "Reject" }, action_id: "reject", value: rejectValue },
        { type: "button", text: { type: "plain_text", text: "Need more docs" }, action_id: "need_more_docs", value: needMoreValue },
      ],
    },
  ];

  await postMessage(blocks);
}
