import type { TokenResponse } from "@solocast/shared";
import type { QualityChoice } from "../player/quality";
import type { WatchHandlers, WatchRoom } from "./room";

/**
 * Mock session (dev and e2e): no WebRTC at all. It reports `waiting`, so the player shows its
 * offline screen, and the stage flow still works end to end against the mock backend.
 */
export class MockWatchRoom implements WatchRoom {
  private open = false;
  private readonly disconnectListeners = new Set<() => void>();

  get connected(): boolean {
    return this.open;
  }

  connect(_token: TokenResponse, handlers: WatchHandlers): Promise<void> {
    this.open = true;
    handlers.onStatus("waiting");
    handlers.onReceived(undefined);
    return Promise.resolve();
  }

  attachVideo(): void {
    // no remote track in mock mode
  }

  setQuality(_choice: QualityChoice): void {
    // no layer to switch in mock mode
  }

  setVolume(): void {
    // no audio element in mock mode
  }

  setMuted(): void {
    // no audio element in mock mode
  }

  enableMicrophone(): Promise<void> {
    return Promise.resolve();
  }

  disableMicrophone(): Promise<void> {
    return Promise.resolve();
  }

  subscribeDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  disconnect(): Promise<void> {
    this.open = false;
    for (const listener of [...this.disconnectListeners]) listener();
    return Promise.resolve();
  }
}
