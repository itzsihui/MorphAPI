/**
 * Mail API v2 — structured payload only.
 * Flat sendEmail(to, from, subject, body) is removed (not deprecated-with-shim).
 *
 * Contract change vs v1 SendResult: `id` → `messageId` + `accepted`.
 * Callers that treated helper return values as a bare string id must adapt.
 */

export interface MailPayload {
  to: string;
  from: string;
  subject: string;
  /** Plain-text body (was positional `body` in v1). */
  content: string;
}

export interface SendResult {
  /** Was `id` on mail-send-v1. */
  messageId: string;
  accepted: boolean;
}

export function send(payload: MailPayload): Promise<SendResult> {
  return Promise.resolve({
    messageId: `msg_v2_${payload.to}_${payload.subject.length}_${payload.content.length}`,
    accepted: true,
  });
}

export default send;
