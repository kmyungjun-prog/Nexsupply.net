/**
 * Slack API client (Phase-B). Uses SLACK_BOT_TOKEN from process.env only.
 * TODO: Stripe replacement later — payment confirmation flow may move to Stripe webhooks; Slack remains for ops notifications.
 */

const SLACK_API_BASE = "https://slack.com/api";

export async function postSlack(endpoint: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN not configured");
  }
  const res = await fetch(`${SLACK_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; error?: string; [k: string]: unknown };
  if (!res.ok) {
    throw new Error(`Slack API error: ${res.status} ${data.error ?? res.statusText}`);
  }
  return data;
}

/** chat.postMessage; channel from process.env.SLACK_PAYMENT_CHANNEL_ID */
export async function postMessage(blocks: unknown[]): Promise<void> {
  const channel = process.env.SLACK_PAYMENT_CHANNEL_ID;
  if (!channel) {
    throw new Error("SLACK_PAYMENT_CHANNEL_ID not configured");
  }
  await postSlack("/chat.postMessage", { channel, blocks });
}

/** chat.update — update message (e.g. after button click) */
export async function updateMessage(channel: string, ts: string, blocks: unknown[]): Promise<void> {
  await postSlack("/chat.update", { channel, ts, blocks });
}
