import { STREAMER_IDENTITY, type TokenResponse } from "@solocast/shared";
import type {
  RemoteAudioTrack,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  VideoQuality,
} from "livekit-client";
import { resolveLivekitUrl } from "../livekitUrl";
import { layerFor, type QualityChoice, type ReceivedVideo } from "../player/quality";
import { WatchRoomError, type WatchHandlers, type WatchRoom, type WatchStatus } from "./room";

type LiveKitModule = typeof import("livekit-client");

/**
 * Real viewer session: `livekit-client` is imported on demand so the home page stays light.
 * Only the streamer's tracks are subscribed. Audio is attached to a dedicated hidden element
 * so the player's volume and mute controls act on one predictable element.
 */
export class LiveKitWatchRoom implements WatchRoom {
  private lk: LiveKitModule | null = null;
  private room: Room | null = null;
  private handlers: WatchHandlers | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private videoPublication: RemoteTrackPublication | null = null;
  private quality: QualityChoice = "auto";
  private volume = 0.8;
  private muted = false;
  private connecting: Promise<void> | null = null;
  private readonly disconnectListeners = new Set<() => void>();

  get connected(): boolean {
    return this.room !== null;
  }

  async connect(token: TokenResponse, handlers: WatchHandlers): Promise<void> {
    this.handlers = handlers;
    if (this.room !== null) {
      // Already watching: report the current state to the new handlers instead of reconnecting.
      handlers.onStatus(this.videoPublication === null ? "waiting" : "live");
      return;
    }
    if (this.connecting !== null) return this.connecting;

    this.connecting = this.open(token).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async open(token: TokenResponse): Promise<void> {
    this.emitStatus("connecting");
    const lk = await import("livekit-client");
    this.lk = lk;
    // adaptiveStream off: the layer follows the viewer's explicit choice, not the element size.
    const room = new lk.Room({
      adaptiveStream: false,
      dynacast: false,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true },
    });
    this.room = room;

    room.on(lk.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (participant.identity !== STREAMER_IDENTITY) return;
      this.onStreamerTrack(track, publication);
    });
    room.on(lk.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      if (participant.identity !== STREAMER_IDENTITY) return;
      track.detach();
      if (publication === this.videoPublication) {
        this.videoPublication = null;
        this.handlers?.onReceived(undefined);
        this.emitStatus("waiting");
      }
    });
    room.on(lk.RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity !== STREAMER_IDENTITY) return;
      this.videoPublication = null;
      this.handlers?.onReceived(undefined);
      this.emitStatus("waiting");
    });
    room.on(lk.RoomEvent.Disconnected, () => {
      if (this.room !== room) return;
      this.room = null;
      this.videoPublication = null;
      this.emitStatus("error");
      for (const listener of [...this.disconnectListeners]) listener();
    });

    try {
      await room.connect(resolveLivekitUrl(token.livekitUrl), token.token);
    } catch {
      this.room = null;
      this.emitStatus("error");
      throw new WatchRoomError("failed");
    }
    this.emitStatus(this.videoPublication === null ? "waiting" : "live");
  }

  private onStreamerTrack(track: RemoteTrack, publication: RemoteTrackPublication): void {
    const lk = this.lk;
    if (lk === null) return;
    if (track.kind === lk.Track.Kind.Video) {
      this.videoPublication = publication;
      this.applyQuality();
      if (this.videoEl) track.attach(this.videoEl);
      this.emitStatus("live");
      this.reportDimensions();
      return;
    }
    if (track.kind === lk.Track.Kind.Audio) {
      const element = this.ensureAudioElement();
      (track as RemoteAudioTrack).attach(element);
      element.volume = this.volume;
      element.muted = this.muted;
      void element.play().catch(() => undefined);
    }
  }

  attachVideo(element: HTMLVideoElement | null): void {
    this.videoEl = element;
    const track = this.videoPublication?.videoTrack;
    if (element !== null && track) {
      track.attach(element);
      this.reportDimensions();
    }
  }

  setQuality(choice: QualityChoice): void {
    this.quality = choice;
    this.applyQuality();
  }

  private applyQuality(): void {
    const lk = this.lk;
    const publication = this.videoPublication;
    if (lk === null || publication === null) return;
    const layer = layerFor(this.quality);
    const quality: VideoQuality =
      layer === "low"
        ? lk.VideoQuality.LOW
        : layer === "medium"
          ? lk.VideoQuality.MEDIUM
          : lk.VideoQuality.HIGH;
    // `auto` asks for the top layer: the SFU still steps down when the link cannot keep up.
    publication.setVideoQuality(quality);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.audioEl) this.audioEl.volume = volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audioEl) this.audioEl.muted = muted;
  }

  async enableMicrophone(): Promise<void> {
    const room = this.room;
    if (room === null) throw new WatchRoomError("failed");
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      throw new WatchRoomError(denied ? "mic_denied" : "failed");
    }
  }

  async disableMicrophone(): Promise<void> {
    const room = this.room;
    if (room === null) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
    } catch {
      // Track already gone or session dead: nothing else to mute.
    }
  }

  subscribeDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  async disconnect(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.videoPublication = null;
    this.audioEl?.remove();
    this.audioEl = null;
    if (room !== null) await room.disconnect();
  }

  private emitStatus(status: WatchStatus): void {
    this.handlers?.onStatus(status);
  }

  private ensureAudioElement(): HTMLAudioElement {
    if (this.audioEl !== null) return this.audioEl;
    const element = document.createElement("audio");
    element.autoplay = true;
    element.hidden = true;
    document.body.append(element);
    this.audioEl = element;
    return element;
  }

  /** Decoded size, read from the element (the only honest source of what is on screen). */
  private reportDimensions(): void {
    const element = this.videoEl;
    const handlers = this.handlers;
    if (element === null || handlers === null) return;
    const report = (): void => {
      const received: ReceivedVideo = {
        width: element.videoWidth,
        height: element.videoHeight,
      };
      handlers.onReceived(received.height > 0 ? received : undefined);
    };
    element.addEventListener("resize", report);
    element.addEventListener("loadedmetadata", report);
    report();
  }
}
