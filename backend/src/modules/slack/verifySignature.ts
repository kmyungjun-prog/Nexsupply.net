import crypto from "node:crypto";
import { AppError } from "../../libs/errors.js";

/**
 * Slack request signature verification (Phase-B).
 * Uses SLACK_SIGNING_SECRET from process.env only; no hardcoded secrets.
 * Rejects invalid or replayed requests (timestamp skew).
 */
const MAX_AGE_SEC = 60 * 5; // 5 minutes

export function verifySlackSignature(rawBody: string, signatureHeader: string | undefined, timestampHeader: string | undefined): void {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    throw new AppError({ statusCode: 503, code: "INTERNAL", message: "Slack signing secret not configured" });
  }
  if (!signatureHeader?.startsWith("v0=") || !timestampHeader) {
    throw new AppError({ statusCode: 401, code: "UNAUTHORIZED", message: "Missing X-Slack-Signature or X-Slack-Request-Timestamp" });
  }

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) {
    throw new AppError({ statusCode: 401, code: "UNAUTHORIZED", message: "Invalid timestamp" });
  }
  const age = Math.abs(Date.now() / 1000 - ts);
  if (age > MAX_AGE_SEC) {
    throw new AppError({ statusCode: 401, code: "UNAUTHORIZED", message: "Request timestamp too old (replay)" });
  }

  const sigBasestring = `v0:${timestampHeader}:${rawBody}`;
  const expected = "v0=" + crypto.createHmac("sha256", secret).update(sigBasestring).digest("hex");

  if (expected.length !== signatureHeader.length) {
    throw new AppError({ statusCode: 401, code: "UNAUTHORIZED", message: "Invalid Slack signature" });
  }
  if (!crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signatureHeader, "utf8"))) {
    throw new AppError({ statusCode: 401, code: "UNAUTHORIZED", message: "Invalid Slack signature" });
  }
}
