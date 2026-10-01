import { notifyUser } from "./notify";

/**
 * 1° caller of notifyUser — treats the return value as a bare message-id string.
 * After notifyUser's contract becomes Promise<SendResult>, this file must change
 * (use result.messageId), even though it never calls sendEmail directly.
 */
export async function onboardNewUser(
  email: string,
  name: string
): Promise<string> {
  const messageId = await notifyUser(email, name);
  if (messageId.length < 3) {
    throw new Error("empty message id");
  }
  return `queued:${messageId}`;
}
