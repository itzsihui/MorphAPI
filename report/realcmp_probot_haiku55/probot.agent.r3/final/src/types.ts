import express from "express";
import {
  createNodeMiddleware,
  EmitterWebhookEvent,
  Webhooks,
} from "@octokit/webhooks";
import LRUCache from "lru-cache";
import Redis from "ioredis";

import { Probot } from "./index";
import { Context } from "./context";
import { ProbotOctokit } from "./octokit/probot-octokit";

import type { Logger, LogFn } from "pino";

export interface Options {
  privateKey?: string;
  githubToken?: string;
  appId?: number | string;

  Octokit?: typeof ProbotOctokit;
  log?: Logger;
  redisConfig?: Redis.RedisOptions | string;
  secret?: string;
  webhookPath?: string;
  logLevel?: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  logMessageKey?: string;
  port?: number;
  host?: string;
  baseUrl?: string;
}

export type State = {
  appId?: number;
  privateKey?: string;
  githubToken?: string;
  log: Logger;
  Octokit: typeof ProbotOctokit;
  octokit: InstanceType<typeof ProbotOctokit>;
  cache?: LRUCache<number, string>;
  webhooks: {
    path: string;
    secret: string;
  };
  port?: number;
  host?: string;
  baseUrl?: string;
};

/**
 * The name of a webhook event, e.g. `push` (without the action suffix)
 */
export type WebhookEventName = EmitterWebhookEvent["name"];

/**
 * A webhook event as used by Probot's `receive()` and `Context`
 */
export interface WebhookEvent<E = any> {
  id: string;
  name: WebhookEventName;
  payload: E;
}

/**
 * The properties that `webhookTransform` adds to every event passed to
 * webhook event handlers (see `src/octokit/octokit-webhooks-transform.ts`)
 */
export type ProbotEventTransform = Omit<Context, "id" | "name" | "payload">;

/**
 * Event handler type for `app.onAny()`, which receives events of any name
 */
export type ProbotOnAnyHandler = (
  event: EmitterWebhookEvent & ProbotEventTransform
) => any;

export type ProbotWebhooks = Omit<Webhooks<ProbotEventTransform>, "onAny"> & {
  onAny: (callback: ProbotOnAnyHandler) => void;
  middleware: ReturnType<typeof createNodeMiddleware>;
};

/**
 * `app.on()` also accepts `"*"`, which is deprecated in favour of `app.onAny()`
 */
export type ProbotOn = ProbotWebhooks["on"] &
  ((event: "*", callback: ProbotOnAnyHandler) => void);

export type DeprecatedLogger = LogFn & Logger;

export type ApplicationFunctionOptions = {
  getRouter?: (path?: string) => express.Router;
  [key: string]: unknown;
};
export type ApplicationFunction = (
  app: Probot,
  options: ApplicationFunctionOptions
) => void;

export type ServerOptions = {
  log?: Logger;
  port?: number;
  host?: string;
  webhookPath?: string;
  webhookProxy?: string;
  Probot: typeof Probot;
};

export type MiddlewareOptions = {
  probot: Probot;
  [key: string]: unknown;
};
