/**
 * Events gateway v1 — polymorphic events discriminated by `type`
 * with SCREAMING_SNAKE values (Discord-style).
 */

export type EventType = "MESSAGE_CREATE" | "MESSAGE_UPDATE" | "REACTION_ADD";

export interface GatewayEvent {
  type: EventType;
  payload: unknown;
}

export type EventHandler = (event: GatewayEvent) => void;

export interface GatewayClient {
  subscribe(types: EventType[], handler: EventHandler): void;
}

export function createGateway(token: string): GatewayClient {
  if (!token) throw new Error("events-gateway-v1 requires a token");
  return {
    subscribe(_types, _handler) {
      /* demo stub */
    },
  };
}

export default createGateway;
