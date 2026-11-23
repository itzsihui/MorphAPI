import type { IncomingMessage, ServerResponse } from "http";

import {
  createNodeMiddleware,
  EmitterWebhookEvent,
  Webhooks,
} from "@octokit/webhooks";

import { ProbotEventTransform, ProbotWebhooks, State } from "../types";
import { getErrorHandler } from "../helpers/get-error-handler";
import { webhookTransform } from "./octokit-webhooks-transform";

const REQUIRED_HEADERS = [
  "x-github-event",
  "x-hub-signature-256",
  "x-github-delivery",
];

export function getWebhooks(state: State): ProbotWebhooks {
  const webhooks = new Webhooks<ProbotEventTransform>({
    secret: state.webhooks.secret,
    transform: webhookTransform.bind(null, state),
  });
  webhooks.onError(getErrorHandler(state.log));

  return Object.assign(webhooks, {
    // `@octokit/webhooks` types `onAny` handlers as receiving the bare event,
    // but the transform is applied to them too, so they receive a `Context`
    onAny: webhooks.onAny as ProbotWebhooks["onAny"],
    middleware: getMiddleware(webhooks, state.webhooks.path),
  });
}

/**
 * Creates the request listener for incoming webhooks. Requests with missing
 * headers are also passed to the error handlers, so that apps and Probot can
 * report them (as `@octokit/webhooks` v7 did).
 */
function getMiddleware(webhooks: Webhooks<ProbotEventTransform>, path: string) {
  const middleware = createNodeMiddleware(webhooks, { path });

  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next?: Function
  ) => {
    const { pathname } = new URL(request.url || "", "http://localhost");
    const missingHeaders = REQUIRED_HEADERS.filter(
      (header) => !(header in request.headers)
    );

    if (
      request.method === "POST" &&
      pathname === path &&
      missingHeaders.length > 0
    ) {
      // `receive()` also accepts errors at runtime, which are passed to the
      // error handlers. Its types don't reflect that, hence the double cast.
      const error = Object.assign(
        new Error(
          `webhooks:receiver ignored: ${request.method} ${
            request.url
          } due to missing headers: ${missingHeaders.join(", ")}`
        ),
        { status: 400 }
      );
      await webhooks
        .receive(error as unknown as EmitterWebhookEvent)
        .catch(() => {
          // the error is reported by the error handlers
        });
    }

    return middleware(request, response, next);
  };
}
