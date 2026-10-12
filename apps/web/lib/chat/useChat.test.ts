import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@solocast/shared";
import { chatFeedReducer, INITIAL_CHAT_FEED, MAX_CLIENT_MESSAGES } from "./useChat";

const msg = (id: string): ChatMessage => ({
  id,
  userId: "u",
  pseudo: "citr0n",
  text: "x",
  ts: 1,
  isStreamer: false,
});

describe("chatFeedReducer", () => {
  it("dédoublonne les messages par id (reconnexion)", () => {
    let s = chatFeedReducer(INITIAL_CHAT_FEED, { type: "message", message: msg("a") });
    s = chatFeedReducer(s, { type: "message", message: msg("a") });
    expect(s.messages).toHaveLength(1);
  });

  it("borne la mémoire côté client", () => {
    const many = Array.from({ length: MAX_CLIENT_MESSAGES + 25 }, (_, i) => msg(`m${String(i)}`));
    const s = chatFeedReducer(INITIAL_CHAT_FEED, { type: "history", messages: many });
    expect(s.messages).toHaveLength(MAX_CLIENT_MESSAGES);
    expect(s.messages[0]?.id).toBe("m25");
  });

  it("nouvelle notice = nouvel id, pour relancer le cooldown", () => {
    const a = chatFeedReducer(INITIAL_CHAT_FEED, { type: "notice", message: "Doucement" });
    const b = chatFeedReducer(a, { type: "notice", message: "Doucement" });
    expect(a.notice?.id).not.toBe(b.notice?.id);
  });
});
