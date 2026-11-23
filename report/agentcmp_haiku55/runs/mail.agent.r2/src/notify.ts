import send, { type SendResult } from "mail-send-v2";

/**
 * Primary product path — user-facing notifications.
 * Uses the structured mail-send-v2 send() API and returns the full SendResult
 * (`messageId` + `accepted`).
 */
export async function notifyUser(
  email: string,
  name: string
): Promise<SendResult> {
  return await send({
    to: email,
    from: "noreply@morphapi.demo",
    subject: "Welcome",
    content: `Hi ${name}, thanks for signing up.`,
  });
}

export async function notifyPasswordReset(
  email: string,
  token: string
): Promise<SendResult> {
  return await send({
    to: email,
    from: "security@morphapi.demo",
    subject: "Reset your password",
    content: `Use this token: ${token}`,
  });
}
