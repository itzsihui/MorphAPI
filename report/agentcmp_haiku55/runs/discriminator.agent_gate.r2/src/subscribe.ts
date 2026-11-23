import createGateway from "events-gateway-v2";
import { handleEvent } from "./router";

/**
 * Listener registration — the "product path" docs emphasize.
 * Downstream switch/case routing lives in router.ts (not shown to LLM-only).
 */
export function startBot() {
  const client = createGateway(process.env.GATEWAY_TOKEN ?? "demo");

  client.subscribe(
    ["message.created", "message.updated", "reaction.added"],
    (event) => {
      handleEvent(event);
    }
  );
}
