import { EmitterWebhookEvent } from "@octokit/webhooks";
import { expectType } from "tsd";
import { Probot } from "../../src";

const app = new Probot({});

app.on("repository.edited", (context) => {
  expectType<EmitterWebhookEvent<"repository.edited">["payload"]>(
    context.payload
  );
});
