import {
  AccessToken,
  IngressClient,
  IngressInput,
  RoomServiceClient,
  ServerError,
  TrackSource,
} from "livekit-server-sdk";
import type { IngressInfo, ParticipantPermission } from "livekit-server-sdk";
import { STREAMER_IDENTITY, type IngestResponse } from "@solocast/shared";
import type { MediaGrant, MediaPermission } from "./grants.js";

// Port vers le SFU LiveKit. Implémentation réelle : createLiveKitGateway. Tests : fake sans réseau.
export interface LiveKitGateway {
  // Crée la room fixe si elle n'existe pas (room.auto_create = false côté SFU, donc
  // personne ne peut rejoindre avant cet appel). Idempotent : CreateRoom renvoie la room existante.
  ensureRoom(): Promise<void>;
  // Ingest OBS : renvoie l'URL RTMP et la clé de flux de l'Ingress de la room, en réutilisant
  // celui déjà en place. `null` quand le service Ingress n'est pas joignable.
  ensureIngress(): Promise<IngestResponse | null>;
  // Émet un JWT LiveKit signé serveur pour la room fixe, identité = identity du grant.
  createToken(grant: MediaGrant): Promise<string>;
  // Remplace atomiquement les droits de publication d'un participant côté SFU.
  // Retourne false si le participant n'est pas (ou plus) connecté à la room.
  updateParticipant(identity: string, permission: MediaPermission): Promise<boolean>;
  // Retire le participant de la room (kick). Retourne false si déjà absent.
  removeParticipant(identity: string): Promise<boolean>;
}

// Sous-ensemble de RoomServiceClient utilisé (permet un fake dans les tests).
export interface RoomServiceLike {
  createRoom(options: { name: string }): Promise<unknown>;
  updateParticipant(
    room: string,
    identity: string,
    metadata: string | undefined,
    permission: Partial<ParticipantPermission>,
  ): Promise<unknown>;
  removeParticipant(room: string, identity: string): Promise<unknown>;
}

// Sous-ensemble d'IngressClient utilisé (permet un fake dans les tests).
export interface IngressServiceLike {
  listIngress(options: { roomName: string }): Promise<IngressInfo[]>;
  createIngress(
    inputType: IngressInput,
    options: {
      name: string;
      roomName: string;
      participantIdentity: string;
      participantName: string;
      enableTranscoding: boolean;
    },
  ): Promise<IngressInfo>;
}

export interface LiveKitGatewayConfig {
  serverUrl: string;
  apiKey: string;
  apiSecret: string;
  roomName: string;
  tokenTtlSeconds: number;
  roomService?: RoomServiceLike;
  ingressService?: IngressServiceLike;
}

const HTTP_NOT_FOUND = 404;

// Sources publiables dérivées des droits. Vide => aucune publication possible.
// Le partage d'écran suit le droit vidéo : il n'est donc ouvert qu'au streameur (les viewers
// n'obtiennent jamais canPublishVideo, cf. viewerMediaGrant). SCREEN_SHARE_AUDIO accompagne
// l'écran, sans quoi l'audio de l'onglet partagé serait refusé par le SFU.
function publishSources(permission: MediaPermission): TrackSource[] {
  return [
    ...(permission.canPublishVideo
      ? [TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
      : []),
    ...(permission.canPublishAudio ? [TrackSource.MICROPHONE] : []),
  ];
}

// Nom de l'Ingress de la room : sert de clé de réutilisation (une seule entrée OBS par room).
const INGRESS_NAME = "solocast-obs";

export function createLiveKitGateway(config: LiveKitGatewayConfig): LiveKitGateway {
  const roomService: RoomServiceLike =
    config.roomService ?? new RoomServiceClient(config.serverUrl, config.apiKey, config.apiSecret);
  const ingressService: IngressServiceLike =
    config.ingressService ??
    new IngressClient(config.serverUrl, config.apiKey, config.apiSecret);

  return {
    async ensureRoom() {
      await roomService.createRoom({ name: config.roomName });
    },

    async ensureIngress() {
      try {
        // La room doit exister AVANT qu'OBS pousse : le SFU tourne avec room.auto_create=false,
        // donc l'Ingress se verrait répondre « requested room does not exist » et couperait le
        // flux aussitôt. La créer ici est la seule occasion : rien ne garantit qu'un viewer
        // (POST /api/token) soit passé avant le streameur.
        await roomService.createRoom({ name: config.roomName });
        const existing = await ingressService.listIngress({ roomName: config.roomName });
        const reusable = existing.find(
          (ingress) => ingress.name === INGRESS_NAME && ingress.streamKey !== "",
        );
        const ingress =
          reusable ??
          (await ingressService.createIngress(IngressInput.RTMP_INPUT, {
            name: INGRESS_NAME,
            roomName: config.roomName,
            // Même identité que la publication navigateur : les viewers s'abonnent au même nom.
            participantIdentity: STREAMER_IDENTITY,
            participantName: STREAMER_IDENTITY,
            // RTMP exige le transcodage (simulcast côté SFU) : cf. §2 « toutes définitions ».
            enableTranscoding: true,
          }));
        if (ingress.url === "" || ingress.streamKey === "") {
          return null;
        }
        return { url: ingress.url, streamKey: ingress.streamKey };
      } catch {
        // Service Ingress éteint ou injoignable : le studio affiche un message, rien ne casse.
        return null;
      }
    },

    async createToken(grant) {
      const sources = publishSources(grant);
      const token = new AccessToken(config.apiKey, config.apiSecret, {
        identity: grant.identity,
        ttl: config.tokenTtlSeconds,
      });
      token.addGrant({
        roomJoin: true,
        room: config.roomName,
        canSubscribe: true,
        canPublishData: false,
        canPublish: sources.length > 0,
        // Liste explicite : un viewer sans can_speak n'a aucune source, jamais la caméra.
        ...(sources.length > 0 ? { canPublishSources: sources } : {}),
      });
      return token.toJwt();
    },

    async updateParticipant(identity, permission) {
      // Mise à jour atomique : tous les champs sont renseignés, sinon le SFU remet les défauts.
      const sources = publishSources(permission);
      try {
        await roomService.updateParticipant(config.roomName, identity, undefined, {
          canSubscribe: true,
          canPublish: sources.length > 0,
          canPublishData: false,
          canPublishSources: sources,
          hidden: false,
          recorder: false,
          canUpdateMetadata: false,
        });
        return true;
      } catch (error) {
        if (error instanceof ServerError && error.status === HTTP_NOT_FOUND) {
          return false;
        }
        throw error;
      }
    },

    async removeParticipant(identity) {
      try {
        await roomService.removeParticipant(config.roomName, identity);
        return true;
      } catch (error) {
        if (error instanceof ServerError && error.status === HTTP_NOT_FOUND) {
          return false;
        }
        throw error;
      }
    },
  };
}
