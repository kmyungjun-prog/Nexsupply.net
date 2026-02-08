/**
 * Google Cloud Storage signed URLs (SOW: short-lived, 10–15 min).
 * Uses @google-cloud/storage, GCS v4, GCS_BUCKET_NAME from env.
 * Write: content-type and expiry enforced. Read: expiry enforced.
 */

import { Storage } from "@google-cloud/storage";
import { AppError } from "./errors.js";

export type SignedUrlAction = "read" | "write";

export type GetSignedUrlInput = {
  action: SignedUrlAction;
  gcsPath: string;
  expiresInSeconds?: number;
  contentType?: string;
};

const DEFAULT_EXPIRES_SECONDS = 15 * 60; // 15 minutes

let storageClient: Storage | null = null;

function getStorageClient(): Storage {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
}

export async function getSignedUrl(input: GetSignedUrlInput): Promise<string> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new AppError({
      statusCode: 500,
      code: "CONFIG",
      message: "GCS_BUCKET_NAME is not set. Configure it in Cloud Run (or backend) environment.",
    });
  }
  const client = getStorageClient();
  const bucket = client.bucket(bucketName);
  const file = bucket.file(input.gcsPath);
  const expiresIn = input.expiresInSeconds ?? DEFAULT_EXPIRES_SECONDS;
  const expires = Date.now() + expiresIn * 1000;

  if (input.action === "write") {
    const options = {
      version: "v4" as const,
      action: "write" as const,
      expires,
      ...(input.contentType ? { contentType: input.contentType } : {}),
    };
    const [url] = await file.getSignedUrl(options);
    return url;
  }

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires,
  });
  return url;
}
