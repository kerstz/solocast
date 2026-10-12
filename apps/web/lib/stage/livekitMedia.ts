import type { TokenResponse } from "@solocast/shared";
import { getWatchRoom, WatchRoomError } from "../watch";
import type { StageMedia, StageMediaHandlers } from "./media";
import { StageMediaError } from "./media";

/**
 * Stage media on top of the viewer's existing WebRTC session: a LiveKit identity can only hold
 * one connection, and the viewer already uses it to watch, so speaking means publishing the
 * microphone on that same room. The right itself comes from the server (stage grant), which
 * raises the participant's publish permission on the SFU.
 */
export class LiveKitStageMedia implements StageMedia {
  private unsubscribe: (() => void) | null = null;

  connect(_token: TokenResponse, handlers: StageMediaHandlers): Promise<void> {
    const room = getWatchRoom();
    if (!room.connected) {
      // No watch session: nothing to publish from (player failed or still connecting).
      return Promise.reject(new StageMediaError("failed"));
    }
    this.unsubscribe?.();
    this.unsubscribe = room.subscribeDisconnect(() => {
      handlers.onDisconnected();
    });
    return Promise.resolve();
  }

  async enableMicrophone(): Promise<void> {
    try {
      await getWatchRoom().enableMicrophone();
    } catch (err) {
      const code =
        err instanceof WatchRoomError && err.code === "mic_denied" ? "mic_denied" : "failed";
      throw new StageMediaError(code);
    }
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    // The room stays open: the viewer keeps watching after leaving the stage.
    await getWatchRoom().disableMicrophone();
  }
}
