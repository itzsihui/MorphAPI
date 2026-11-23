import { createS3Client, GetObjectCommand } from "aws-s3-v2";

/**
 * Leaf I/O only — AWS SDK v3-style GetObjectCommand sent through the client.
 * Callers live in app.ts (separate file / DFG edge).
 */
const s3 = createS3Client();

export async function fetchObjectBody(
  bucket: string,
  key: string
): Promise<string> {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return result.Body;
}

export async function loadBanner(bucket: string): Promise<string> {
  const body = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: "banner.txt" })
  );
  return body.Body;
}
