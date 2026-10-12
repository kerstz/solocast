import { VIEWER_COLORS, type ViewerColor } from "@solocast/shared";

/**
 * Chat colour derived from the username: there is no account and no colour picker any more,
 * yet the same name always gets the same colour, which keeps the chat readable.
 */
export function colorForUsername(username: string): ViewerColor {
  let hash = 0;
  for (let index = 0; index < username.length; index += 1) {
    hash = (hash * 31 + username.charCodeAt(index)) % 100_000;
  }
  return VIEWER_COLORS[hash % VIEWER_COLORS.length] as ViewerColor;
}
