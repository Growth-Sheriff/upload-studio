/**
 * R2 Storage Service — Cloudflare R2 via S3-compatible API
 * Used to fetch PSD templates and upload generated mockups
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

let s3Client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT || "",
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return s3Client;
}

/**
 * Download a file from R2 as Buffer
 */
export async function downloadFromR2(key: string): Promise<Buffer> {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME || "us-mockups";

  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );

  if (!response.Body) {
    throw new Error(`[R2] Empty body for key: ${key}`);
  }

  const chunks: Uint8Array[] = [];
  const stream = response.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Upload a buffer to R2
 * Returns public URL
 */
export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string = "image/png"
): Promise<string> {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME || "us-mockups";

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000",
    })
  );

  const publicUrl = process.env.R2_PUBLIC_URL || "";
  return `${publicUrl}/${key}`;
}
