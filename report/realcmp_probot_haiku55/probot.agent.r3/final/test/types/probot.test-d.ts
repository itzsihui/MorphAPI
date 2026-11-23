import { expectType } from "tsd";
import { Probot } from "../../src";

const app = new Probot({});

app.on("repository.edited", (context) => {
  expectType<string>(context.payload.repository.name);
  expectType<string>(context.payload.repository.owner.login);
});
