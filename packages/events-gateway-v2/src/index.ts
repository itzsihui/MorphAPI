/**
 * Events gateway v2 — SAME polymorphism, mutated discriminator:
 *   type → event_type
 *   MESSAGE_CREATE → message.created
 *   MESSAGE_UPDATE → message.updated
 *   REACTION_ADD → reaction.added
 *
 * Updating subscribe() intents while leaving switch/case arms on the old
 * property/values is the classic discriminator-mutation failure.
 */

export type EventType =
  | "message.created"
  | "message.updated"
  | "reaction.added";

export interface GatewayEvent {
  event_type: EventType;
  payload: unknown;
}

export type EventHandler = (event: GatewayEvent) => void;

export interface GatewayClient {
  subscribe(types: EventType[], handler: EventHandler): void;
}

export function createGateway(token: string): GatewayClient {
  if (!token) throw new Error("events-gateway-v2 requires a token");
  return {
    subscribe(_types, _handler) {
      /* demo stub */
    },
  };
}

export default createGateway;
