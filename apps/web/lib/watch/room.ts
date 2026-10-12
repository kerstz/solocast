import type { TokenResponse } from "@solocast/shared";
import type { QualityChoice, ReceivedVideo } from "../player/quality";

export type WatchStatus = "connecting" | "waiting" | "live" | "error";

export interface WatchHandlers {
  /** `waiting` = connected to the room but the streamer publishes nothing yet. */
  onStatus: (status: WatchStatus) => void;
  /** Dimensions actually decoded, `undefined` when no video is playing. */
  onReceived: (received: ReceivedVideo | undefined) => void;
}

/**
 * The viewer's single WebRTC session. It subscribes to the streamer's camera and microphone,
 * and it is also the session a viewer publishes from once the streamer grants the stage:
 * one LiveKit identity means one connection, so watching and speaking share this room.
 */
export interface WatchRoom {
  readonly connected: boolean;
  connect(token: TokenResponse, handlers: WatchHandlers): Promise<void>;
  /** Element the remote video renders into. `null` detaches. */
  attachVideo(element: HTMLVideoElement | null): void;
  /** Requested simulcast layer; `auto` lets the SFU choose. */
  setQuality(choice: QualityChoice): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Stage: publish the microphone. Throws `WatchRoomError('mic_denied' | 'failed')`. */
  enableMicrophone(): Promise<void>;
  disableMicrophone(): Promise<void>;
  /** Notified when the session drops (server kick, network, page teardown). Returns an unsubscribe. */
  subscribeDisconnect(listener: () => void): () => void;
  /** Leaves the room entirely (page unload). */
  disconnect(): Promise<void>;
}

export class WatchRoomError extends Error {
  constructor(readonly code: "mic_denied" | "failed") {
    super(code);
    this.name = "WatchRoomError";
  }
}
