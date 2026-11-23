import type { IncomingMessage, ServerResponse } from "http";

import { createNodeMiddleware, Webhooks } from "@octokit/webhooks";

import { ProbotWebhooks, ProbotWebhookTransform, State } from "../types";
import { getErrorHandler } from "../helpers/get-error-handler";
import { webhookTransform } from "./octokit-webhooks-transform";

const SIGNATURE_HEADER = "x-hub-signature-256";

export function getWebhooks(state: State): ProbotWebhooks {
  const webhooks = new Webhooks<ProbotWebhookTransform>({
    secret: state.webhooks.secret,
    transform: webhookTransform.bind(null, state),
    log: state.log,
  });
  const errorHandler = getErrorHandler(state.log);
  webhooks.onError(errorHandler);

  const nodeMiddleware = createNodeMiddleware(webhooks, {
    path: state.webhooks.path,
    log: state.log,
  });

  const middleware = (
    request: IncomingMessage,
    response: ServerResponse,
    next?: Function
  ) => {
    // `createNodeMiddleware()` responds with a 400 to requests without the
    // signature header, without reporting an error. Report it so the hint about
    // the webhook secret is logged.
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (
      request.method === "POST" &&
      pathname === state.webhooks.path &&
      !request.headers[SIGNATURE_HEADER]
    ) {
      errorHandler(
        new Error(
          `webhooks:receiver ignored: POST ${pathname} due to missing headers: ${SIGNATURE_HEADER}`
        )
      );
    }

    return nodeMiddleware(request, response, next);
  };

  return Object.assign(webhooks, { middleware });
}
