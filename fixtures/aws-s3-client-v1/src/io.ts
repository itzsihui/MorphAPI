import { createS3Client } from "aws-s3-v1";

/**
 * Leaf I/O only — AWS SDK v2 getObject().promise().
 * Callers live in app.ts (separate file / DFG edge).
 */
const s3 = createS3Client();

export function fetchObjectBody(
  bucket: string,
  key: string
): Promise<string> {
  return s3.getObject({ Bucket: bucket, Key: key }).promise().then((result) => {
    return result.Body;
  });
}

export function loadBanner(bucket: string): Promise<string> {
  return s3
    .getObject({ Bucket: bucket, Key: "banner.txt" })
    .promise()
    .then((body) => body.Body);
}
