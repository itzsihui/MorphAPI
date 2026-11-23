import { createS3Client, GetObjectCommand } from "aws-s3-v2";

/**
 * Leaf I/O only — AWS SDK v2-style getObject().promise() replaced by
 * GetObjectCommand + client.send().
 * Callers live in app.ts (separate file / DFG edge).
 */
const s3 = createS3Client();

export function fetchObjectBody(
  bucket: string,
  key: string
): Promise<string> {
  return s3
    .send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    .then((result) => {
      return result.Body;
    });
}

export function loadBanner(bucket: string): Promise<string> {
  return s3
    .send(new GetObjectCommand({ Bucket: bucket, Key: "banner.txt" }))
    .then((body) => body.Body);
}
