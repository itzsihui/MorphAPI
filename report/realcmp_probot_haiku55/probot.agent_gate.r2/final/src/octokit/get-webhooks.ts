import { Webhooks } from "@octokit/webhooks";

import { ProbotWebhooks, State } from "../types";
import { getErrorHandler } from "../helpers/get-error-handler";
import { webhookTransform } from "./octokit-webhooks-transform";

import { Context } from "../context";

export function getWebhooks(state: State): ProbotWebhooks {
  const webhooks = new Webhooks<Omit<Context, "id" | "name" | "payload">>({
    secret: state.webhooks.secret,
    transform: webhookTransform.bind(null, state),
    log: state.log,
  });
  webhooks.onError(getErrorHandler(state.log));
  return webhooks;
}
