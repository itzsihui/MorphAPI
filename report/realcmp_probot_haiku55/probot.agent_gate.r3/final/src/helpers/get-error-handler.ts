import type { Logger } from "pino";
import { EmitterWebhookEvent, WebhookError } from "@octokit/webhooks";

export function getErrorHandler(log: Logger) {
  return (error: Error) => {
    const errors = (
      error.name === "AggregateError" ? error : [error]
    ) as WebhookError[];

    const event = (error as any).event as EmitterWebhookEvent | undefined;

    for (const error of errors) {
      const errMessage = (error.message || "").toLowerCase();

      // v9 reports a wrong secret as "signature does not match", while missing
      // headers are answered by the middleware directly (never reaching here)
      if (
        errMessage.includes("x-hub-signature") ||
        errMessage.includes("signature does not match")
      ) {
        log.error(
          error,
          "Go to https://github.com/settings/apps/YOUR_APP and verify that the Webhook secret matches the value of the WEBHOOK_SECRET environment variable."
        );
        continue;
      }

      if (errMessage.includes("pem") || errMessage.includes("json web token")) {
        log.error(
          error,
          "Your private key (a .pem file or PRIVATE_KEY environment variable) or APP_ID is incorrect. Go to https://github.com/settings/apps/YOUR_APP, verify that APP_ID is set correctly, and generate a new PEM file if necessary."
        );
        continue;
      }

      log
        .child({
          name: "event",
          id: event ? event.id : undefined,
        })
        .error(error);
    }
  };
}
