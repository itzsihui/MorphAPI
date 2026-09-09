# AWS S3 Client Migration Guide (v2 → v3 style)

Legacy code uses the AWS SDK v2 request pattern:

```ts
const result = await s3.getObject({ Bucket, Key }).promise();
```

Modern AWS SDK for JavaScript (v3) uses command objects sent through the client.

## Overview

Replace `getObject(...).promise()` with the v3 command + send pattern.
Create the client from `aws-s3-v2` and construct a `GetObjectCommand` for each read.

## Typical pattern

```ts
import { createS3Client, GetObjectCommand } from "aws-s3-v2";

const client = createS3Client();

// Send a GetObjectCommand with the same Bucket / Key fields.
// The send() call returns a Promise for the object output.
```

## Notes

- `getObject` is not a method on the v3 client.
- Prefer `GetObjectCommand` + `client.send(...)`.
- Preserve existing helper names: `fetchObjectBody`, `loadSettings`, `bootApp`, `loadBanner`.
- The docs do not spell out every await/async annotation — match whatever the new client types require.
