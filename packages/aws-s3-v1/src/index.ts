/**
 * Legacy AWS SDK v2-style S3 client.
 * Callers use s3.getObject(params).promise().
 */

export interface GetObjectOutput {
  Body: string;
  ContentType?: string;
}

export interface GetObjectRequest {
  Bucket: string;
  Key: string;
}

export interface AwsRequest<T> {
  promise(): Promise<T>;
}

export interface S3 {
  getObject(params: GetObjectRequest): AwsRequest<GetObjectOutput>;
}

export function createS3Client(): S3 {
  return {
    getObject(params) {
      return {
        async promise() {
          return {
            Body: JSON.stringify({
              theme: "dark",
              region: params.Bucket,
              key: params.Key,
            }),
            ContentType: "application/json",
          };
        },
      };
    },
  };
}

export default createS3Client;
