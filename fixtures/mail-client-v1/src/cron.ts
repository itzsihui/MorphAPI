import sendEmail from "mail-send-v1";

/**
 * Nightly cron — ops digest (often forgotten in partial migrations).
 */
export async function runNightlyDigest(opsInbox: string, summary: string) {
  await sendEmail(
    opsInbox,
    "cron@morphapi.demo",
    "Nightly digest",
    summary
  );
}
