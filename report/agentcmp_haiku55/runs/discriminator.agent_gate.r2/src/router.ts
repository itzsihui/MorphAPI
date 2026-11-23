import type { GatewayEvent } from "events-gateway-v2";

/**
 * Internal router — discriminates on event.event_type.
 * Miss this file and v2 migration fallthroughs / type errors appear here.
 */
export function handleEvent(event: GatewayEvent): string {
  switch (event.event_type) {
    case "message.created":
      return handleMessageCreate(event);
    case "message.updated":
      return handleMessageUpdate(event);
    case "reaction.added":
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
