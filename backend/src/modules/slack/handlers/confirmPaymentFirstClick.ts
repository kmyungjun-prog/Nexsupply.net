import { updateMessage } from "../slackClient.js";

/**
 * Phase-C UX: Confirm Payment first click → "Are you sure?" (1회 추가 확인, 실수 방지).
 * Updates message to show Yes / Cancel; actual transition happens on confirm_payment_ack.
 */
export async function handleConfirmPaymentFirstClick(payload: {
  projectId: string;
  idempotencyKey: string;
  channel?: { id: string };
  message?: { ts: string };
}): Promise<void> {
  if (!payload.channel?.id || !payload.message?.ts) return;

  const confirmValue = JSON.stringify({ projectId: payload.projectId, idempotencyKey: payload.idempotencyKey });
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Payment request* — Project \`${payload.projectId}\`. Are you sure you want to confirm payment?`,
      },
    },
    {
      type: "actions",
      block_id: "payment_confirm_actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "Yes, confirm payment" }, action_id: "confirm_payment_ack", value: confirmValue, style: "primary" },
        { type: "button", text: { type: "plain_text", text: "Cancel" }, action_id: "confirm_payment_cancel", value: payload.projectId },
      ],
    },
  ];
  await updateMessage(payload.channel.id, payload.message.ts, blocks);
}
