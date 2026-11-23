import { EmitterWebhookEvent } from "@octokit/webhooks";

import { Context } from "../context";
import { State } from "../types";

/**
 * Probot's transform option, which extends the `event` object that is passed
 * to webhook event handlers by `@octokit/webhooks`
 * @see https://github.com/octokit/webhooks.js/#constructor
 */
export async function webhookTransform(
  state: State,
  event: EmitterWebhookEvent
) {
  const log = state.log.child({ name: "event", id: event.id });
  const octokit = (await state.octokit.auth({
    type: "event-octokit",
    event,
  })) as typeof state.octokit;
  // the event payload is a union of all webhook payloads, so use the default `any`
  return new Context<any>(event, octokit, log);
}
