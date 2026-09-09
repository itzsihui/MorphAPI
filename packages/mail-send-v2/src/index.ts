/**
 * Mail API v2 — structured payload only.
 * Flat sendEmail(to, from, subject, body) is removed (not deprecated-with-shim).
 */

export interface MailPayload {
  to: string;
  from: string;
  subject: string;
  /** Plain-text body (was positional `body` in v1). */
  content: string;
}

export interface SendResult {
  id: string;
}

export function send(payload: MailPayload): Promise<SendResult> {
  return Promise.resolve({
    id: `msg_v2_${payload.to}_${payload.subject.length}_${payload.content.length}`,
  });
}

export default send;
