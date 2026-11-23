import send from "mail-send-v2";

/**
 * Nightly cron — ops digest (often forgotten in partial migrations).
 */
export async function runNightlyDigest(opsInbox: string, summary: string) {
  await send({
    to: opsInbox,
    from: "cron@morphapi.demo",
    subject: "Nightly digest",
    content: summary,
  });
}
