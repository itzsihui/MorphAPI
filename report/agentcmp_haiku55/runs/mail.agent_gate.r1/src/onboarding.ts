import { notifyUser } from "./notify";

/**
 * 1° caller of notifyUser — notifyUser now returns SendResult,
 * so the message id is read from `.messageId`.
 */
export async function onboardNewUser(
  email: string,
  name: string
): Promise<string> {
  const result = await notifyUser(email, name);
  const messageId = result.messageId;
  if (messageId.length < 3) {
    throw new Error("empty message id");
  }
  return `queued:${messageId}`;
}
