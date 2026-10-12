import { config } from "../config";
import { LiveKitWatchRoom } from "./livekitRoom";
import { MockWatchRoom } from "./mockRoom";
import type { WatchRoom } from "./room";

export type { WatchHandlers, WatchRoom, WatchStatus } from "./room";
export { WatchRoomError } from "./room";

let instance: WatchRoom | null = null;

/** Single viewer session per tab: watching and speaking share one LiveKit identity. */
export function getWatchRoom(): WatchRoom {
  if (!instance) {
    instance = config.mode === "mock" ? new MockWatchRoom() : new LiveKitWatchRoom();
  }
  return instance;
}
