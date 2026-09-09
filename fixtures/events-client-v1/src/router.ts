import type { GatewayEvent } from "events-gateway-v1";

/**
 * Internal router — discriminates on event.type.
 * Miss this file and v2 migration fallthroughs / type errors appear here.
 */
export function handleEvent(event: GatewayEvent): string {
  switch (event.type) {
    case "MESSAGE_CREATE":
      return handleMessageCreate(event);
    case "MESSAGE_UPDATE":
      return handleMessageUpdate(event);
    case "REACTION_ADD":
      return handleReaction(event);
    default:
      return "ignored";
  }
}

function handleMessageCreate(_event: GatewayEvent): string {
  return "message_create";
}

function handleMessageUpdate(_event: GatewayEvent): string {
  return "message_update";
}

function handleReaction(_event: GatewayEvent): string {
  return "reaction_add";
}
