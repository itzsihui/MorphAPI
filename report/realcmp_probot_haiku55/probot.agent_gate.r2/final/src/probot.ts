import type { RequestListener } from "http";
import LRUCache from "lru-cache";
import { Logger } from "pino";
import { EmitterWebhookEvent } from "@octokit/webhooks";

import { aliasLog } from "./helpers/alias-log";
import { auth } from "./auth";
import { getLog } from "./helpers/get-log";
import { getProbotOctokitWithDefaults } from "./octokit/get-probot-octokit-with-defaults";
import { getWebhooks } from "./octokit/get-webhooks";
import { createWebhooksMiddleware } from "./helpers/create-webhooks-middleware";
import { ProbotOctokit } from "./octokit/probot-octokit";
import { VERSION } from "./version";
import {
  ApplicationFunction,
  DeprecatedLogger,
  Options,
  ProbotWebhooks,
  State,
} from "./types";

export type Constructor<T> = new (...args: any[]) => T;

export class Probot {
  static version = VERSION;
  static defaults<S extends Constructor<any>>(this: S, defaults: Options) {
    const ProbotWithDefaults = class extends this {
      constructor(...args: any[]) {
        const options = args[0] || {};
        super(Object.assign({}, defaults, options));
      }
    };

    return ProbotWithDefaults;
  }

  public webhooks: ProbotWebhooks;
  public log: DeprecatedLogger;
  public version: String;
  public on: ProbotWebhooks["on"];
  public onAny: ProbotWebhooks["onAny"];
  public onError: ProbotWebhooks["onError"];
  public auth: (
    installationId?: number,
    log?: Logger
  ) => Promise<InstanceType<typeof ProbotOctokit>>;

  private state: State;

  constructor(options: Options = {}) {
    options.webhookPath = options.webhookPath || "/";
    options.secret = options.secret || "development";

    let level = options.logLevel;
    const logMessageKey = options.logMessageKey;

    this.log = aliasLog(options.log || getLog({ level, logMessageKey }));

    // TODO: support redis backend for access token cache if `options.redisConfig`
    const cache = new LRUCache<number, string>({
      // cache max. 15000 tokens, that will use less than 10mb memory
      max: 15000,
      // Cache for 1 minute less than GitHub expiry
      maxAge: 1000 * 60 * 59,
    });

    const Octokit = getProbotOctokitWithDefaults({
      githubToken: options.githubToken,
      Octokit: options.Octokit || ProbotOctokit,
      appId: Number(options.appId),
      privateKey: options.privateKey,
      cache,
      log: this.log,
      redisConfig: options.redisConfig,
      baseUrl: options.baseUrl,
    });
    const octokit = new Octokit();

    this.state = {
      cache,
      githubToken: options.githubToken,
      log: this.log,
      Octokit,
      octokit,
      webhooks: {
        path: options.webhookPath,
        secret: options.secret,
      },
      appId: Number(options.appId),
      privateKey: options.privateKey,
      host: options.host,
      port: options.port,
    };

    this.auth = auth.bind(null, this.state);

    this.webhooks = getWebhooks(this.state);

    this.on = (eventNameOrNames, callback) => {
      // `@octokit/webhooks` no longer supports the "*" event name, so it is
      // mapped to `onAny()` here
      if ((eventNameOrNames as unknown) === "*") {
        this.log.warn(
          `[probot] Using the "*" event with the regular app.on() function is deprecated. Please use the app.webhooks.onAny() method instead`
        );
        // `onAny()` is typed for the untransformed event, handlers receive the transformed one
        return this.webhooks.onAny(
          callback as Parameters<ProbotWebhooks["onAny"]>[0]
        );
      }

      return this.webhooks.on(eventNameOrNames, callback);
    };

    this.onAny = this.webhooks.onAny;
    this.onError = this.webhooks.onError;

    this.version = VERSION;
  }

  public receive(event: {
    id: string;
    name: EmitterWebhookEvent["name"];
    payload: unknown;
  }) {
    this.log.debug({ event }, "Webhook received");
    return this.webhooks.receive(event as EmitterWebhookEvent);
  }

  /**
   * Returns the request listener that receives webhook deliveries on the
   * configured `webhookPath`.
   */
  public getWebhooksMiddleware(): RequestListener {
    return createWebhooksMiddleware(
      this.webhooks,
      this.state.webhooks.path || "/",
      this.state.log
    );
  }

  public async load(appFn: ApplicationFunction | ApplicationFunction[]) {
    if (Array.isArray(appFn)) {
      for (const fn of appFn) {
        await this.load(fn);
      }
      return;
    }

    return appFn(this, {});
  }
}
