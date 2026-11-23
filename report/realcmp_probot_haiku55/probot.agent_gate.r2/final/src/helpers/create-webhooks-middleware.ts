import { IncomingMessage, RequestListener, ServerResponse } from "http";

import { createNodeMiddleware } from "@octokit/webhooks";
import type { Logger } from "pino";

import { getErrorHandler } from "./get-error-handler";
import { ProbotWebhooks } from "../types";

const REQUIRED_WEBHOOK_HEADERS = [
  "x-github-event",
  "x-hub-signature-256",
  "x-github-delivery",
];

/**
 * Creates the request listener that receives webhook deliveries on `path`,
 * based on `createNodeMiddleware()` from `@octokit/webhooks`.
 *
 * Probot keeps its own behavior on top of it: requests for other routes are
 * passed on to `next()` when used with Express and answered with a 404
 * otherwise, and deliveries without the required GitHub headers are logged
 * through Probot's error handler (which explains where to find the webhook
 * secret when the signature header is missing).
 */
export function createWebhooksMiddleware(
  webhooks: ProbotWebhooks,
  path: string,
  log: Logger
): RequestListener {
  const middleware = createNodeMiddleware(webhooks, {
    path,
    log,
    onUnhandledRequest(request, response) {
      response.statusCode = 404;
      response.end("Not found");
    },
  });
  const handleError = getErrorHandler(log);

  return function webhooksMiddleware(
    request: IncomingMessage,
    response: ServerResponse,
    next?: (error?: unknown) => void
  ) {
    const { pathname } = new URL(request.url || "/", "http://localhost");

    if (request.method === "POST" && pathname === path) {
      const missingHeaders = REQUIRED_WEBHOOK_HEADERS.filter(
        (header) => !(header in request.headers)
      );

      if (missingHeaders.length) {
        handleError(
          new Error(
            `[@octokit/webhooks] Required headers missing: ${missingHeaders.join(
              ", "
            )}`
          )
        );
      }
    }

    return middleware(request, response, next);
  };
}
