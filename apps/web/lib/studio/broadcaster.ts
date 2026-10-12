import type { TokenResponse } from "@solocast/shared";
import type * as LiveKitTypes from "livekit-client";
import { config } from "../config";
import { resolveLivekitUrl } from "../livekitUrl";
import { resolutionDimensions, type StreamSettings, type SettingKey } from "./settings";

// Le mock n'est chargé que si le build est en mode mock : la condition est résolue au build
// (constante inlinée), donc `mockChat` ne part pas dans le bundle de production.
function setMockLive(live: boolean): void {
  if (!__MOCK_BACKEND__) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("../backend/mockChat") as typeof import("../backend/mockChat")).setMockLive(live);
}

export type BroadcastErrorCode = "not_authorized" | "mic_denied" | "failed" | "settings_failed";

export class BroadcastError extends Error {
  constructor(readonly code: BroadcastErrorCode) {
    super(code);
    this.name = "BroadcastError";
  }
}

export interface BroadcastHandlers {
  /** Appelé quand la session SFU se coupe sans que le studio l'ait demandé. */
  onLost: () => void;
}

/**
 * Diffusion navigateur du streameur : caméra (ou partage d'écran) + micro publiés dans la room
 * via livekit-client.
 * Le publish n'a lieu qu'après un token serveur qui autorise vidéo ET audio.
 */
export interface BrowserBroadcaster {
  start(
    token: TokenResponse,
    settings: StreamSettings,
    preview: HTMLVideoElement | null,
    handlers: BroadcastHandlers,
  ): Promise<void>;
  /** Applique les réglages changés à la piste en cours. Les réglages « next_start » attendent le prochain start. */
  applySettings(settings: StreamSettings, changed: readonly SettingKey[]): Promise<void>;
  /** Coupe la source vidéo et le micro, ferme la session. Idempotent. */
  stop(): Promise<void>;
}

export class LiveKitBroadcaster implements BrowserBroadcaster {
  private room: LiveKitTypes.Room | null = null;
  private lk: typeof LiveKitTypes | null = null;

  async start(
    token: TokenResponse,
    settings: StreamSettings,
    preview: HTMLVideoElement | null,
    handlers: BroadcastHandlers,
  ): Promise<void> {
    if (!token.canPublishVideo || !token.canPublishAudio) {
      throw new BroadcastError("not_authorized");
    }
    const lk = await import("livekit-client");
    this.lk = lk;
    const room = new lk.Room({
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true },
    });
    this.room = room;

    room.on(lk.RoomEvent.Disconnected, () => {
      // stop() remet room à null avant de couper : seule une coupure inattendue arrive ici.
      if (this.room !== room) return;
      this.room = null;
      handlers.onLost();
    });

    await room.connect(resolveLivekitUrl(token.livekitUrl), token.token);

    const dims = resolutionDimensions(settings.resolution);
    const publishOptions = {
      simulcast: settings.simulcast,
      videoEncoding: { maxBitrate: settings.maxBitrateKbps * 1000, maxFramerate: settings.fps },
    };
    try {
      if (settings.source === "screen") {
        // Partage d'écran : seule source possible sans webcam. L'audio de l'onglet est pris si
        // le navigateur le propose ; le micro est publié séparément dans tous les cas.
        await room.localParticipant.setScreenShareEnabled(
          true,
          {
            audio: true,
            resolution: { width: dims.width, height: dims.height, frameRate: settings.fps },
          },
          publishOptions,
        );
      } else {
        await room.localParticipant.setCameraEnabled(
          true,
          { resolution: { width: dims.width, height: dims.height, frameRate: settings.fps } },
          publishOptions,
        );
      }
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      await this.stop();
      throw new BroadcastError(denied ? "mic_denied" : "failed");
    }

    const video = this.videoTrack(settings.source);
    if (preview && video) video.attach(preview);
  }

  /** Piste vidéo publiée, quelle que soit la source choisie au dernier start. */
  private videoTrack(source: StreamSettings["source"]): LiveKitTypes.LocalTrack | undefined {
    const room = this.room;
    const lk = this.lk;
    if (!room || !lk) return undefined;
    const trackSource = source === "screen" ? lk.Track.Source.ScreenShare : lk.Track.Source.Camera;
    return room.localParticipant.getTrackPublication(trackSource)?.track;
  }

  async applySettings(settings: StreamSettings, changed: readonly SettingKey[]): Promise<void> {
    const room = this.room;
    const lk = this.lk;
    if (!room || !lk) return;
    const video = this.videoTrack(settings.source);
    if (!video) return;

    try {
      if (changed.includes("resolution") || changed.includes("fps")) {
        const dims = resolutionDimensions(settings.resolution);
        await video.mediaStreamTrack.applyConstraints({
          width: { ideal: dims.width },
          height: { ideal: dims.height },
          frameRate: { ideal: settings.fps },
        });
      }
      if (changed.includes("maxBitrateKbps")) {
        const sender = video.sender;
        if (sender) {
          // Débit max modifiable à chaud sur le RTCRtpSender, sans renégociation.
          const params = sender.getParameters();
          for (const encoding of params.encodings) {
            encoding.maxBitrate = settings.maxBitrateKbps * 1000;
          }
          await sender.setParameters(params);
        }
      }
    } catch {
      throw new BroadcastError("settings_failed");
    }
  }

  async stop(): Promise<void> {
    const room = this.room;
    this.room = null;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
      await room.localParticipant.setCameraEnabled(false);
      await room.localParticipant.setScreenShareEnabled(false);
    } catch {
      // piste déjà coupée ou session morte : on ferme quand même
    }
    await room.disconnect();
  }
}

/** Diffuseur factice (mock) : aucun micro, aucune connexion. Le compteur « EN DIRECT » suit l'état. */
export class MockBroadcaster implements BrowserBroadcaster {
  start(token: TokenResponse): Promise<void> {
    if (!token.canPublishVideo || !token.canPublishAudio) {
      return Promise.reject(new BroadcastError("not_authorized"));
    }
    setMockLive(true);
    return Promise.resolve();
  }

  applySettings(): Promise<void> {
    return Promise.resolve();
  }

  stop(): Promise<void> {
    setMockLive(false);
    return Promise.resolve();
  }
}

let instance: BrowserBroadcaster | null = null;

/** Diffuseur singleton côté navigateur. Le réel est importé dynamiquement (bundle studio léger). */
export function getBroadcaster(): BrowserBroadcaster {
  if (!instance) {
    instance = config.mode === "mock" ? new MockBroadcaster() : new LiveKitBroadcaster();
  }
  return instance;
}
