# SoloCast

A simple streaming site designed for a single user: a streamer broadcasts, viewers watch, and everyone participates in the chat. It features a video player, a real-time chat, and a queue for viewers who want to be invited on screen. The interface is intentionally styled to resemble websites from the early 2000s.

This was created for broadcasting to a small group of people, not as a general-purpose platform. There are no accounts or databases; a simple username is all that's needed to join.

![Homepage](docs/img/accueil.png)

## Features

The viewing page: video player, chat, and a button to request to speak.

![Viewing Page](docs/img/watch.png)

The streamer's studio: browser-based or OBS streaming, capture settings, counters, a queue for viewers requesting to speak (with options to allow or ban), and a read-only chat for moderation.

![Streamer Studio](docs/img/studio.png)

The screenshots are from the mock mode (`NEXT_PUBLIC_BACKEND_MODE=mock`), so the video player is "offline": there's no actual video stream behind it.

## Code Organization

Monorepo using pnpm:

- `apps/web`: The frontend, built with Next.js.
- `apps/backend`: The API and the chat's WebSocket server, built with Fastify.
- `packages/shared`: Shared Zod contracts used by both the frontend and backend.

## Prerequisites

- Node >= 20 (tested with 26)
- pnpm 9 (`npm i -g pnpm@9.15.9`)
- Docker: Only required for WebRTC video (LiveKit), see the "Video" section.
- `cloudflared`: Only required for `./start.sh` (to provide a shareable public address).

## Local Setup

```sh
pnpm install
cp .env.example .env          # A local .env file is already provided here
pnpm dev
```

- Frontend: http://localhost:3001 (username selection, then `/watch`)
- Streamer Studio: http://localhost:3001/studio (no key required: whoever opens the page gets the studio)
- Backend: http://localhost:3000 (`GET /health`)

Functions without Docker: viewer identity, WebSocket chat, presence detection, request to speak, and moderation. `STATE_BACKEND=memory` keeps all the state within the backend process: **no Redis is needed**. The state is lost on each restart, which is intentional for local development.

## Sharing with a Script (`./start.sh`)

```sh
./start.sh
```

This starts the backend (3000), the frontend (3001), a single-origin reverse proxy (8080, `scripts/share-proxy.mjs`), and a `cloudflared` tunnel, then displays the public address:

```
Address to share: https://<random-words>.trycloudflare.com
```

Ctrl+C stops all four processes; logs are saved in `.run/`. Additional prerequisite: `cloudflared` must be installed.

**The address is public and password-free:** Anyone who opens it can watch the live stream, participate in the chat, and can open `/studio` to broadcast and moderate. Only share this with trusted individuals, and close it after use – a Cloudflare tunnel changes its address with each launch.

Why a proxy: The frontend, API, and WebSocket must originate from **a single domain**, otherwise the session cookie (SameSite=Lax) won't be followed, and the CORS allowlist won't be able to cover both domains. The script therefore exports `CORS_ORIGIN=<tunnel URL>` and `COOKIE_SECURE=true` before starting the backend, and serves the frontend with `NEXT_PUBLIC_API_BASE_URL=""` and `NEXT_PUBLIC_WS_URL=/ws`.

### Configuration

- `.env` (root): Backend and Docker infrastructure. Read by `apps/backend` (`--env-file`) and by `docker compose`. Never versioned; the commented template is `.env.example`.
- `apps/web/.env.local`: `NEXT_PUBLIC_*` variables (Next.js only reads the `.env` file from its own directory). Setting `NEXT_PUBLIC_BACKEND_MODE=mock` runs the frontend alone, without the backend or LiveKit.

## Video (LiveKit)

Without LiveKit, the player remains in "Stream offline" mode: the rest of the app functions. To enable video, start the SFU and the RTMP/WHIP ingress:

```sh
docker compose up -d redis livekit ingress
```

The `LIVEKIT_*` keys in the `.env` file are used by the SFU, the backend (for signed tokens), and the OBS ingress (`rtmp://localhost:1935/x/<stream-key>`). Ports and budgets are documented in `docker-compose.yml`.

The "live" flag in `presence:update` is only set to `true` when the SFU signals the streamer via the `participant_joined` webhook (the `webhook` block in the `LIVEKIT_CONFIG` of `docker-compose.yml`, pointing to `LIVEKIT_WEBHOOK_URL`). Without this webhook, the studio will still display "ON AIR" as soon as the streamer starts broadcasting, and the viewer will display "LIVE" as soon as they receive the stream – this information is local and potentially inaccurate. Nothing in the interface indicates a live stream unless the server or the browser can prove it.

**The webhook will not work with the default `.env` file.** LiveKit runs in a container and connects to the host using `host.docker.internal` (which is the Docker bridge gateway, e.g., `172.17.0.1`), while `BACKEND_HOST=127.0.0.1` only makes the backend listen on the local loopback interface. To enable it:

```sh
BACKEND_HOST=0.0.0.0 pnpm dev            # The backend also listens on the Docker bridge
sudo ufw allow in on docker0 to any port 3000   # If a firewall is running (ufw, firewalld…)
```

`BACKEND_HOST=0.0.0.0` exposes the backend to the entire local network: this should only be used on a trusted development machine. Without this setting, only the "live" indicator in the studio remains at `OFFLINE`; the chat, presence, and video on the viewer side function normally.

## Quality

```sh
pnpm lint         # ESLint (root flat config, strict typing)
pnpm typecheck    # tsc --noEmit on the 3 packages
pnpm test         # Vitest (184 tests)
pnpm format       # Prettier
pnpm build        # shared + backend (tsc) + web (next build)
```

E2E Playwright (frontend only, backend mocked): `pnpm --filter @solocast/web test:e2e` — 8 tests
(viewer walkthrough + studio), all passing. The test server is started by Playwright on port 3101 with `NEXT_PUBLIC_BACKEND_MODE=mock`: neither the backend nor LiveKit is required.
