/**
 * Legacy mail API — flat positional sendEmail(to, from, subject, body).
 * v2 reshapes to send({ to, from, subject, content }).
 */

export interface SendResult {
  id: string;
}

/**
 * @deprecated Prefer mail-send-v2 `send({ ... })` structured payload.
 */
export function sendEmail(
  to: string,
  from: string,
  subject: string,
  body: string
): Promise<SendResult> {
  return Promise.resolve({
    id: `msg_v1_${to}_${subject.length}_${body.length}`,
  });
}

export default sendEmail;
