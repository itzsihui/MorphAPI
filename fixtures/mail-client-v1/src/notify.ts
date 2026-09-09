import sendEmail from "mail-send-v1";

/**
 * Primary product path — user-facing notifications.
 * Migrate mail-send-v1 → mail-send-v2 structured send().
 */
export async function notifyUser(email: string, name: string) {
  await sendEmail(
    email,
    "noreply@morphapi.demo",
    "Welcome",
    `Hi ${name}, thanks for signing up.`
  );
}

export async function notifyPasswordReset(email: string, token: string) {
  await sendEmail(
    email,
    "security@morphapi.demo",
    "Reset your password",
    `Use this token: ${token}`
  );
}
