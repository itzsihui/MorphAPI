import { Context } from "../context";
import { State, WebhookEvent } from "../types";

/**
 * Probot's transform option, which extends the `event` object that is passed
 * to webhook event handlers by `@octokit/webhooks`
 * @see https://github.com/octokit/webhooks.js/#constructor
 */
export async function webhookTransform(
  state: State,
  event: WebhookEvent
): Promise<Context> {
  const log = state.log.child({ name: "event", id: event.id });
  const octokit = (await state.octokit.auth({
    type: "event-octokit",
    event,
  })) as typeof state.octokit;
  // The payload type depends on the event name, which is only known at runtime
  return new Context<any>(event, octokit, log);
}
