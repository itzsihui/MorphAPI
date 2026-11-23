import LRUCache from "lru-cache";
import { RequestListener } from "http";

import { Logger } from "pino";

import { aliasLog } from "./helpers/alias-log";
import { auth } from "./auth";
import { getLog } from "./helpers/get-log";
import { getWebhooksMiddleware } from "./helpers/get-webhooks-middleware";
import { getProbotOctokitWithDefaults } from "./octokit/get-probot-octokit-with-defaults";
import { getWebhooks } from "./octokit/get-webhooks";
import { ProbotOctokit } from "./octokit/probot-octokit";
import { VERSION } from "./version";
import {
  ApplicationFunction,
  DeprecatedLogger,
  Options,
  ProbotWebhooks,
  State,
  WebhookEvent,
} from "./types";

function isEventName(eventNameOrNames: string | string[], name: string) {
  return eventNameOrNames === name;
}

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
  /** Node.js request listener that receives and verifies incoming webhooks */
  public middleware: RequestListener;
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
    this.middleware = getWebhooksMiddleware(
      this.webhooks,
      this.state.webhooks.path,
      this.log
    );

    this.on = (eventNameOrNames, callback) => {
      if (isEventName(eventNameOrNames, "*")) {
        this.log.warn(
          `[probot] Using the "*" event with the regular app.on() function is deprecated. Please use the app.webhooks.onAny() method instead`
        );
        // `onAny()` handlers receive the same transformed event as `on()`
        // handlers, but @octokit/webhooks types them as receiving the raw event
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

  public receive(event: WebhookEvent) {
    this.log.debug({ event }, "Webhook received");
    return this.webhooks.receive(event);
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
