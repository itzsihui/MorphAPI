import sendEmail from "mail-send-v1";

/**
 * Primary product path — user-facing notifications.
 * Migrate mail-send-v1 → mail-send-v2 structured send().
 *
 * v1 helpers return the bare message id string (`SendResult.id`).
 * v2 helpers should return the full `SendResult` (`messageId` + `accepted`) —
 * callers one hop away (see onboarding.ts) must adapt.
 */
export async function notifyUser(
  email: string,
  name: string
): Promise<string> {
  const r = await sendEmail(
    email,
    "noreply@morphapi.demo",
    "Welcome",
    `Hi ${name}, thanks for signing up.`
  );
  return r.id;
}

export async function notifyPasswordReset(
  email: string,
  token: string
): Promise<string> {
  const r = await sendEmail(
    email,
    "security@morphapi.demo",
    "Reset your password",
    `Use this token: ${token}`
  );
  return r.id;
}
