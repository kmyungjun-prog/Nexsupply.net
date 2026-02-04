import { updateMessage } from "../slackClient.js";

/** Phase-C UX: Cancel on "Are you sure?" → restore or show cancelled. */
export async function handleConfirmPaymentCancel(payload: {
  projectId: string;
  channel?: { id: string };
  message?: { ts: string };
}): Promise<void> {
  if (!payload.channel?.id || !payload.message?.ts) return;
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Cancelled* — Payment confirmation for project \`${payload.projectId}\` was cancelled.`,
      },
    },
  ];
  await updateMessage(payload.channel.id, payload.message.ts, blocks);
}
