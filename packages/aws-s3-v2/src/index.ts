/**
 * Target AWS SDK v3-style S3 client.
 *
 * getObject().promise() is gone. Use:
 *   await client.send(new GetObjectCommand({ Bucket, Key }))
 *
 * Deliberate traps:
 * - No getObject on the client
 * - No .promise() on send()
 * - No GetObjectRequest factory / S3.getObject
 */

export interface GetObjectOutput {
  Body: string;
  ContentType?: string;
}

export interface GetObjectRequest {
  Bucket: string;
  Key: string;
}

export class GetObjectCommand {
  readonly input: GetObjectRequest;
  constructor(input: GetObjectRequest) {
    this.input = input;
  }
}

export interface S3Client {
  send(command: GetObjectCommand): Promise<GetObjectOutput>;
}

export function createS3Client(): S3Client {
  return {
    async send(command) {
      return {
        Body: JSON.stringify({
          theme: "dark",
          region: command.input.Bucket,
          key: command.input.Key,
        }),
        ContentType: "application/json",
      };
    },
  };
}

export default createS3Client;
