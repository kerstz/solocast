// Droits média d'un participant LiveKit. Décidés UNIQUEMENT côté serveur (état Redis), jamais par le client.

import { STREAMER_IDENTITY } from "@solocast/shared";

export { STREAMER_IDENTITY };

export interface MediaPermission {
  canPublishAudio: boolean;
  canPublishVideo: boolean;
}

export interface MediaGrant extends MediaPermission {
  identity: string;
}

export function streamerMediaGrant(): MediaGrant {
  return { identity: STREAMER_IDENTITY, canPublishAudio: true, canPublishVideo: true };
}

// Viewer : vidéo JAMAIS accordée. Le micro n'est accordé qu'avec un grant can_speak (Redis).
export function viewerMediaGrant(viewerId: string, canSpeak: boolean): MediaGrant {
  return { identity: viewerId, canPublishAudio: canSpeak, canPublishVideo: false };
}
