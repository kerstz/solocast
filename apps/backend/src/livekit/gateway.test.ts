import { randomBytes } from "node:crypto";
import { decodeJwt, jwtVerify } from "jose";
import { ServerError } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import type { IngressInfo, IngressInput } from "livekit-server-sdk";
import {
  createLiveKitGateway,
  type IngressServiceLike,
  type RoomServiceLike,
} from "./gateway.js";
import { streamerMediaGrant, viewerMediaGrant } from "./grants.js";

const API_KEY = "test-livekit-key";
const API_SECRET = randomBytes(32).toString("hex");
const VIEWER_ID = "6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6";

interface VideoClaims {
  room?: string;
  roomJoin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishSources?: string[];
}

class FakeRoomService implements RoomServiceLike {
  readonly calls: { room: string; identity: string; permission: Record<string, unknown> }[] = [];
  readonly created: string[] = [];
  error: Error | undefined = undefined;

  createRoom(options: { name: string }): Promise<unknown> {
    this.created.push(options.name);
    return this.error === undefined ? Promise.resolve({}) : Promise.reject(this.error);
  }

  removeParticipant(room: string, identity: string): Promise<unknown> {
    this.calls.push({ room, identity, permission: { removed: true } });
    return this.error === undefined ? Promise.resolve({}) : Promise.reject(this.error);
  }

  updateParticipant(
    room: string,
    identity: string,
    _metadata: string | undefined,
    permission: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ room, identity, permission });
    return this.error === undefined ? Promise.resolve({}) : Promise.reject(this.error);
  }
}

function gatewayWith(roomService: RoomServiceLike, ingressService?: IngressServiceLike) {
  return createLiveKitGateway({
    serverUrl: "http://127.0.0.1:7880",
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    roomName: "main",
    tokenTtlSeconds: 600,
    roomService,
    ...(ingressService === undefined ? {} : { ingressService }),
  });
}

// Ingress factice : compte les créations pour vérifier la réutilisation.
class FakeIngressService implements IngressServiceLike {
  existing: IngressInfo[] = [];
  created = 0;
  error: Error | undefined = undefined;

  listIngress(): Promise<IngressInfo[]> {
    return this.error === undefined ? Promise.resolve(this.existing) : Promise.reject(this.error);
  }

  createIngress(
    _inputType: IngressInput,
    options: { name: string; roomName: string; participantIdentity: string },
  ): Promise<IngressInfo> {
    this.created += 1;
    const info = {
      ...options,
      url: "rtmp://localhost:1935/x",
      streamKey: `key-${String(this.created)}`,
    } as unknown as IngressInfo;
    this.existing = [info];
    return Promise.resolve(info);
  }
}

async function videoClaimsOf(token: string): Promise<VideoClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(API_SECRET), {
    algorithms: ["HS256"],
  });
  const video: unknown = payload.video;
  const claims: VideoClaims = typeof video === "object" && video !== null ? video : {};
  return claims;
}

describe("createToken : grants LiveKit réels (JWT signé, décodé)", () => {
  it("signe avec la clé API, identité = identity du grant, TTL 600 s", async () => {
    const gateway = gatewayWith(new FakeRoomService());
    const token = await gateway.createToken(viewerMediaGrant(VIEWER_ID, false));
    const { payload } = await jwtVerify(token, new TextEncoder().encode(API_SECRET), {
      algorithms: ["HS256"],
    });
    expect(payload.iss).toBe(API_KEY);
    expect(payload.sub).toBe(VIEWER_ID);
    // TTL court (WP7) : expiration dans les 600 s, sans marge au-delà.
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(payload.exp).toBeGreaterThan(nowSeconds + 590);
    expect(payload.exp).toBeLessThanOrEqual(nowSeconds + 600);
    expect(decodeJwt(token).sub).toBe(VIEWER_ID);
  });

  it("streamer : publication audio + caméra, abonnement, room main", async () => {
    const token = await gatewayWith(new FakeRoomService()).createToken(streamerMediaGrant());
    const video = await videoClaimsOf(token);
    expect(video).toMatchObject({
      room: "main",
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    // Le partage d'écran suit le droit vidéo : c'est la seule source du streameur sans webcam.
    expect(video.canPublishSources).toEqual([
      "camera",
      "screen_share",
      "screen_share_audio",
      "microphone",
    ]);
  });

  it("viewer sans can_speak : aucune publication, aucune source", async () => {
    const token = await gatewayWith(new FakeRoomService()).createToken(
      viewerMediaGrant(VIEWER_ID, false),
    );
    const video = await videoClaimsOf(token);
    expect(video.canPublish).toBe(false);
    expect(video.canSubscribe).toBe(true);
    expect(video.canPublishSources).toBeUndefined();
  });

  it("viewer can_speak : micro uniquement, JAMAIS la caméra", async () => {
    const token = await gatewayWith(new FakeRoomService()).createToken(
      viewerMediaGrant(VIEWER_ID, true),
    );
    const video = await videoClaimsOf(token);
    expect(video.canPublish).toBe(true);
    expect(video.canPublishSources).toEqual(["microphone"]);
    expect(video.canPublishSources).not.toContain("camera");
    // Ni la caméra ni l'écran : un viewer ne publie jamais d'image.
    expect(video.canPublishSources).not.toContain("screen_share");
  });
});

describe("updateParticipant : coupure côté SFU", () => {
  it("retire toute publication, en renseignant tous les champs (mise à jour atomique)", async () => {
    const roomService = new FakeRoomService();
    const connected = await gatewayWith(roomService).updateParticipant(VIEWER_ID, {
      canPublishAudio: false,
      canPublishVideo: false,
    });
    expect(connected).toBe(true);
    expect(roomService.calls).toEqual([
      {
        room: "main",
        identity: VIEWER_ID,
        permission: {
          canSubscribe: true,
          canPublish: false,
          canPublishData: false,
          canPublishSources: [],
          hidden: false,
          recorder: false,
          canUpdateMetadata: false,
        },
      },
    ]);
  });

  it("participant absent du SFU (404) : retourne false sans lever d'erreur", async () => {
    const roomService = new FakeRoomService();
    roomService.error = new ServerError("not_found", "participant not found", 404);
    const connected = await gatewayWith(roomService).updateParticipant(VIEWER_ID, {
      canPublishAudio: false,
      canPublishVideo: false,
    });
    expect(connected).toBe(false);
  });

  it("autre erreur SFU : propagée à l'appelant", async () => {
    const roomService = new FakeRoomService();
    roomService.error = new ServerError("unavailable", "boom", 503);
    await expect(
      gatewayWith(roomService).updateParticipant(VIEWER_ID, {
        canPublishAudio: false,
        canPublishVideo: false,
      }),
    ).rejects.toThrow(ServerError);
  });
});

describe("ensureRoom : la room fixe doit exister avant toute connexion", () => {
  it("crée la room nommée dans la configuration", async () => {
    const service = new FakeRoomService();
    await gatewayWith(service).ensureRoom();
    expect(service.created).toEqual(["main"]);
  });

  it("propage l'échec : le jeton ne doit pas être émis si la room n'existe pas", async () => {
    const service = new FakeRoomService();
    service.error = new ServerError("unavailable", "boom", 503);
    await expect(gatewayWith(service).ensureRoom()).rejects.toThrow();
  });
});

describe("ensureIngress : entrée OBS de la room", () => {
  it("crée l'ingress RTMP sur l'identité du streameur", async () => {
    const ingress = new FakeIngressService();
    const result = await gatewayWith(new FakeRoomService(), ingress).ensureIngress();
    expect(ingress.created).toBe(1);
    expect(result).toEqual({ url: "rtmp://localhost:1935/x", streamKey: "key-1" });
  });

  // Régression : sans room, l'Ingress reçoit « requested room does not exist » du SFU
  // (room.auto_create=false) et coupe le flux RTMP dès la première image.
  it("crée la room avant de rendre la clé de flux", async () => {
    const rooms = new FakeRoomService();
    await gatewayWith(rooms, new FakeIngressService()).ensureIngress();
    expect(rooms.created).toEqual(["main"]);
  });

  it("réutilise l'ingress déjà en place (une seule clé de flux)", async () => {
    const ingress = new FakeIngressService();
    const gateway = gatewayWith(new FakeRoomService(), ingress);
    const first = await gateway.ensureIngress();
    const second = await gateway.ensureIngress();
    expect(ingress.created).toBe(1);
    expect(second).toEqual(first);
  });

  it("renvoie null quand le service Ingress est injoignable", async () => {
    const ingress = new FakeIngressService();
    ingress.error = new Error("ECONNREFUSED");
    expect(await gatewayWith(new FakeRoomService(), ingress).ensureIngress()).toBeNull();
  });
});
