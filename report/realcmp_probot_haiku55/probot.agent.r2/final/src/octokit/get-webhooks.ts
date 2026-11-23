import { Webhooks } from "@octokit/webhooks";

import { ProbotWebhookContext, ProbotWebhooks, State } from "../types";
import { getErrorHandler } from "../helpers/get-error-handler";
import { webhookTransform } from "./octokit-webhooks-transform";

export function getWebhooks(state: State): ProbotWebhooks {
  const webhooks = new Webhooks<ProbotWebhookContext>({
    secret: state.webhooks.secret,
    transform: webhookTransform.bind(null, state),
  });
  webhooks.onError(getErrorHandler(state.log));
  return webhooks;
}
