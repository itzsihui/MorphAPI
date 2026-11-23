import { createNodeMiddleware, Webhooks } from "@octokit/webhooks";

import { State } from "../types";
import { getErrorHandler } from "../helpers/get-error-handler";
import { webhookTransform } from "./octokit-webhooks-transform";

import { Context } from "../context";

export function getWebhooks(state: State) {
  const webhooks = new Webhooks<Omit<Context, "id" | "name" | "payload">>({
    secret: state.webhooks.secret,
    transform: webhookTransform.bind(null, state),
  });
  webhooks.onError(getErrorHandler(state.log));
  // @octokit/webhooks v9 no longer exposes a middleware on the Webhooks
  // instance, so it is attached here to keep `probot.webhooks.middleware` working
  return Object.assign(webhooks, {
    middleware: createNodeMiddleware(webhooks, { path: state.webhooks.path }),
  });
}
