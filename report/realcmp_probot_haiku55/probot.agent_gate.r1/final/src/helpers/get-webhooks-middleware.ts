import { IncomingMessage, RequestListener, ServerResponse } from "http";

import type { Logger } from "pino";
import { createNodeMiddleware } from "@octokit/webhooks";

import { getErrorHandler } from "./get-error-handler";
import { ProbotWebhooks } from "../types";

/**
 * Wraps the `@octokit/webhooks` node middleware so that requests missing the
 * signature header are logged with the same hint about the webhook secret that
 * is logged for invalid signatures. `@octokit/webhooks` rejects such requests
 * with a 400 response before any error handler is called.
 */
export function getWebhooksMiddleware(
  webhooks: ProbotWebhooks,
  path: string,
  log: Logger
): RequestListener {
  const middleware = createNodeMiddleware(webhooks, { path });
  const errorHandler = getErrorHandler(log);

  return (
    request: IncomingMessage,
    response: ServerResponse,
    next?: Function
  ) => {
    const { pathname } = new URL(request.url || "", "http://localhost");
    const isWebhookRequest = request.method === "POST" && pathname === path;

    if (isWebhookRequest && !("x-hub-signature-256" in request.headers)) {
      errorHandler(
        new Error("[@octokit/webhooks] x-hub-signature-256 header is missing")
      );
    }

    return middleware(request, response, next);
  };
}
