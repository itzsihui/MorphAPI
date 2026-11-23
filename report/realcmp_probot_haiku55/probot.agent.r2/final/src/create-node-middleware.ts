import { RequestListener } from "http";
import { createNodeMiddleware as createWebhooksNodeMiddleware } from "@octokit/webhooks";

import { ApplicationFunction } from "./types";
import { MiddlewareOptions } from "./types";

export function createNodeMiddleware(
  appFn: ApplicationFunction,
  { probot }: MiddlewareOptions
): RequestListener {
  probot.load(appFn);

  return createWebhooksNodeMiddleware(probot.webhooks, {
    path: probot.webhookPath,
  });
}
