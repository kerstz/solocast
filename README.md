# SoloCast

Un petit site de streaming pour une seule personne : un streameur diffuse, les spectateurs
regardent et discutent dans le chat. Il y a un lecteur vidéo, un chat en temps réel, et une file
de demandes de parole pour inviter un spectateur sur scène. L'interface est volontairement
habillée comme un site du début des années 2000.

Je l'ai fait pour diffuser à un petit groupe de gens, pas pour être une plateforme générale.
Pas de comptes, pas de base de données : un pseudo suffit pour entrer.

![Page d'accueil](docs/img/accueil.png)

## Ce que ça montre

La page de visionnage : lecteur, chat, bouton pour demander la parole.

![Page de visionnage](docs/img/watch.png)

Le studio du streameur : diffusion navigateur ou OBS, réglages de capture, compteurs, file des
demandes de parole avec Allow / Ban, et le chat en lecture seule pour modérer.

![Studio du streameur](docs/img/studio.png)

Les captures viennent du mode mock (`NEXT_PUBLIC_BACKEND_MODE=mock`), donc le lecteur y est
« offline » : il n'y a pas de vrai flux vidéo derrière.

## Organisation du code

Monorepo pnpm :

- `apps/web` : le front, en Next.js
- `apps/backend` : l'API et le WebSocket du chat, en Fastify
- `packages/shared` : les contrats Zod partagés entre les deux

## Prérequis

- Node >= 20 (testé en 26)
- pnpm 9 (`npm i -g pnpm@9.15.9`)
- Docker : uniquement pour la vidéo WebRTC (LiveKit), cf. §Vidéo
- `cloudflared` : uniquement pour `./start.sh` (adresse publique partageable)

## Démarrage local

```sh
pnpm install
cp .env.example .env          # un .env local est déjà présent ici
pnpm dev
```

- Front : http://localhost:3001 (choix du pseudo, puis `/watch`)
- Studio streameur : http://localhost:3001/studio (aucune clé : qui ouvre la page prend le studio)
- Backend : http://localhost:3000 (`GET /health`)

Fonctionnent sans Docker : identité viewer, chat WebSocket, présence, demande de parole,
modération. `STATE_BACKEND=memory` garde tout l'état dans le process backend : **aucun Redis à
lancer**. L'état est perdu à chaque redémarrage, ce qui est voulu en local.

## Partager en un script (`./start.sh`)

```sh
./start.sh
```

Lance le backend (3000), le front (3001), un reverse proxy mono-origine (8080, `scripts/share-proxy.mjs`)
et un tunnel `cloudflared`, puis affiche l'adresse publique :

```
Adresse à partager : https://<mots-au-hasard>.trycloudflare.com
```

Ctrl+C arrête les quatre processus ; les journaux restent dans `.run/`. Prérequis en plus :
`cloudflared` installé.

**L'adresse est publique et sans mot de passe** : quiconque l'ouvre regarde le direct, écrit dans
le chat, et peut ouvrir `/studio` pour diffuser et modérer. À ne partager
qu'avec des gens de confiance, et à couper après usage — un tunnel rapide Cloudflare change
d'adresse à chaque lancement.

Pourquoi un proxy : le front, l'API et le WebSocket doivent sortir sous **une seule origine**,
sinon le cookie de session (SameSite=Lax) ne suit pas et l'allowlist CORS ne peut pas couvrir les
deux domaines. Le script exporte donc `CORS_ORIGIN=<url du tunnel>` et `COOKIE_SECURE=true` avant
de démarrer le backend, et sert le front avec `NEXT_PUBLIC_API_BASE_URL=""` + `NEXT_PUBLIC_WS_URL=/ws`.

### Configuration

- `.env` (racine) : backend + infrastructure Docker. Lu par `apps/backend` (`--env-file`) et par
  `docker compose`. Jamais versionné ; le modèle commenté est `.env.example`.
- `apps/web/.env.local` : variables `NEXT_PUBLIC_*` (Next ne lit que le `.env` de son dossier).
  `NEXT_PUBLIC_BACKEND_MODE=mock` fait tourner le front seul, sans backend ni LiveKit.

## Vidéo (LiveKit)

Sans LiveKit, le lecteur reste sur « Stream offline » : le reste de l'app fonctionne. Pour la
vidéo, lancer le SFU et l'ingress RTMP/WHIP :

```sh
docker compose up -d redis livekit ingress
```

Les clés `LIVEKIT_*` du `.env` servent au SFU, au backend (tokens signés) et à l'ingress OBS
(`rtmp://localhost:1935/x/<stream-key>`). Ports et budgets : commentaires de `docker-compose.yml`.

Le drapeau « direct » de `presence:update` vaut `true` uniquement quand le SFU signale le
streameur via le webhook `participant_joined` (bloc `webhook` du `LIVEKIT_CONFIG` de
`docker-compose.yml`, pointant sur `LIVEKIT_WEBHOOK_URL`). Sans ce webhook,
le studio affiche quand même ON AIR dès qu'il publie lui-même, et le viewer affiche LIVE dès
qu'il reçoit la piste : ces informations-là sont locales et certaines. Rien dans l'interface
n'annonce un direct que le serveur ou le navigateur ne peut pas prouver.

**Le webhook ne marche pas avec le `.env` par défaut.** LiveKit tourne dans un conteneur et
joint l'hôte par `host.docker.internal` (→ la passerelle du pont Docker, p. ex. `172.17.0.1`),
alors que `BACKEND_HOST=127.0.0.1` ne fait écouter le backend que sur la boucle locale. Pour
l'activer :

```sh
BACKEND_HOST=0.0.0.0 pnpm dev            # le backend écoute aussi sur le pont Docker
sudo ufw allow in on docker0 to any port 3000   # si un pare-feu tourne (ufw, firewalld…)
```

`BACKEND_HOST=0.0.0.0` expose le backend à tout le réseau local : à réserver à une machine de
développement de confiance. Sans ce réglage, seule la jauge « direct » du studio reste à
`OFFLINE` ; le chat, la présence et la vidéo côté viewer fonctionnent normalement.

## Qualité

```sh
pnpm lint         # ESLint (flat config racine, typage strict)
pnpm typecheck    # tsc --noEmit sur les 3 packages
pnpm test         # Vitest (184 tests)
pnpm format       # Prettier
pnpm build        # shared + backend (tsc) + web (next build)
```

E2E Playwright (front seul, backend mock) : `pnpm --filter @solocast/web test:e2e` — 8 tests
(parcours viewer + studio), verts. Le serveur de test est lancé par Playwright sur le port 3101
en `NEXT_PUBLIC_BACKEND_MODE=mock` : ni backend ni LiveKit requis.
