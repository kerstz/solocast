#!/usr/bin/env bash
# SoloCast — lanceur local.
#
#   ./start.sh              démarre tout en local        -> http://localhost:3001
#   ./start.sh --share      idem + adresse publique partageable (tunnel Cloudflare)
#   ./start.sh --help       toutes les options
#
# Le script libère les ports qu'il lui faut, démarre l'infra média Docker si elle est
# disponible, construit les contrats partagés, lance le backend et le front, puis attend que
# les deux répondent avant de rendre la main. Ctrl+C arrête tout. Journaux dans .run/.
#
# Portée de la vidéo : le média WebRTC va du navigateur au SFU LiveKit en direct, jamais par le
# tunnel. En --share, le chat marche pour tout le monde ; la vidéo ne marche que pour les
# navigateurs qui joignent LIVEKIT_PUBLIC_WS_URL (l'hôte, ou le LAN si LIVEKIT_NODE_IP est l'IP
# LAN). Pour un direct public : déployer LiveKit derrière un domaine (cf. README).

set -euo pipefail
set -m # job control : chaque service a son groupe de processus, donc s'arrête entièrement

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RUN_DIR="$ROOT/.run"
TUNNEL_LOG="$RUN_DIR/tunnel.log"
PIDS=()

SHARE=0        # --share  : tunnel Cloudflare + proxy mono-origine
FORCE=0        # --force  : tuer aussi un processus étranger au projet qui tient un port
NO_DOCKER=0    # --no-docker : ne pas toucher à redis/livekit/ingress
NO_INSTALL=0   # --no-install : sauter `pnpm install`
WEBHOOK=0      # --webhook : exposer le backend au pont Docker (jauge « direct » du studio)

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$1" >&2; }
die() {
  printf '\033[1;31m==>\033[0m %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./start.sh [options]

  (aucune option)  Démarrage local : backend 3000, front 3001.
  --share          Publie en plus une adresse https://<...>.trycloudflare.com.
                   ATTENTION : adresse publique et sans mot de passe. Quiconque l'ouvre
                   regarde le direct, écrit dans le chat, et peut prendre le studio.
                   Exige `cloudflared`.
  --webhook        Fait écouter le backend sur toutes les interfaces (BACKEND_HOST=0.0.0.0)
                   pour que le SFU LiveKit, qui tourne en conteneur, puisse joindre
                   /webhooks/livekit. Sans ça la jauge « direct » du studio reste OFFLINE.
                   ATTENTION : expose le backend à tout le réseau local.
  --force          Tue aussi un processus étranger au projet qui occupe un port requis.
                   Sans cette option, le script s'arrête et affiche de qui il s'agit.
  --no-docker      Ne démarre pas redis/livekit/ingress (chat OK, vidéo indisponible).
  --no-install     Saute `pnpm install` (démarrage plus rapide si rien n'a bougé).
  -h, --help       Cette aide.

Ports (surchargeables par variable d'environnement) :
  local   BACKEND_PORT=3000  WEB_PORT=3001
  --share BACKEND_PORT=3002  WEB_PORT=3003  SHARE_PORT=8080
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --share) SHARE=1 ;;
    --force) FORCE=1 ;;
    --no-docker) NO_DOCKER=1 ;;
    --no-install) NO_INSTALL=1 ;;
    --webhook) WEBHOOK=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "Option inconnue : $1 (voir ./start.sh --help)" ;;
  esac
  shift
done

# Ports par défaut : le mode partage en utilise d'autres pour pouvoir cohabiter avec `pnpm dev`.
if [ "$SHARE" = 1 ]; then
  BACKEND_PORT="${BACKEND_PORT:-3002}"
  WEB_PORT="${WEB_PORT:-3003}"
  SHARE_PORT="${SHARE_PORT:-8080}"
else
  BACKEND_PORT="${BACKEND_PORT:-3000}"
  WEB_PORT="${WEB_PORT:-3001}"
fi

cleanup() {
  trap - EXIT INT TERM
  say "Arrêt…"
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] || continue
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- Prérequis ---------------------------------------------------------------
needed=(pnpm node curl)
[ "$SHARE" = 1 ] && needed+=(cloudflared)
for tool in "${needed[@]}"; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool est introuvable. Voir README §Prérequis."
done
[ -f "$ROOT/.env" ] || die "Pas de .env. Copier le modèle : cp .env.example .env"

mkdir -p "$RUN_DIR"

# --- Libération des ports ----------------------------------------------------
# Un `pnpm dev` oublié, ou un `tsx watch` orphelin qui a survécu à son parent, tient le port et
# ferait échouer le démarrage. On les arrête — mais seulement s'ils appartiennent à ce projet :
# tuer à l'aveugle ce qui écoute sur 3000 pourrait emporter un service sans rapport.

pids_on_port() { # port -> PIDs, un par ligne
  command -v ss >/dev/null 2>&1 || return 0
  ss -ltnpH "sport = :$1" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
}

describe_pid() { # PID -> "commande (cwd)"
  local pid="$1" cmd cwd
  cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | cut -c1-90)"
  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  printf '%s (cwd: %s)' "${cmd:-inconnu}" "${cwd:-inconnu}"
}

# Un processus « du projet » : son répertoire courant est sous la racine du dépôt.
belongs_to_project() {
  local cwd
  cwd="$(readlink "/proc/$1/cwd" 2>/dev/null || true)"
  [ -n "$cwd" ] && [ "${cwd#"$ROOT"}" != "$cwd" ]
}

free_port() { # port, libellé
  local port="$1" label="$2" pid
  local pids
  pids="$(pids_on_port "$port")"
  [ -n "$pids" ] || return 0

  for pid in $pids; do
    if ! belongs_to_project "$pid" && [ "$FORCE" != 1 ]; then
      die "Port $port ($label) tenu par un processus hors du projet :
      PID $pid — $(describe_pid "$pid")
  Arrêter ce service, choisir un autre port (${label^^}_PORT=…), ou relancer avec --force."
    fi
    say "Port $port ($label) occupé par le PID $pid — arrêt."
    kill -TERM "$pid" 2>/dev/null || true
  done

  # Les enfants d'un `pnpm dev` survivent à leur parent et gardent la socket : on repasse.
  for _ in $(seq 1 10); do
    pids="$(pids_on_port "$port")"
    [ -n "$pids" ] || return 0
    sleep 0.5
  done
  for pid in $(pids_on_port "$port"); do
    warn "PID $pid n'a pas rendu le port $port — SIGKILL."
    kill -KILL "$pid" 2>/dev/null || true
  done
  sleep 0.5
  [ -z "$(pids_on_port "$port")" ] || die "Le port $port est toujours occupé. Voir : ss -ltnp | grep :$port"
}

free_port "$BACKEND_PORT" "backend"
free_port "$WEB_PORT" "web"
[ "$SHARE" = 1 ] && free_port "$SHARE_PORT" "share"

# --- Infra média (Docker) ----------------------------------------------------
# Sans LiveKit : chat, présence, modération et studio fonctionnent ; /api/token répond
# 502 sfu_unavailable et le lecteur reste sur « Stream offline ». Un échec Docker n'est donc
# jamais fatal — on prévient et on continue.
export LIVEKIT_WEBHOOK_URL="http://host.docker.internal:$BACKEND_PORT/webhooks/livekit"
if [ "$NO_DOCKER" = 1 ]; then
  say "Docker ignoré (--no-docker) : chat OK, vidéo indisponible."
elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  say "Démarrage de redis + livekit + ingress…"
  if ! docker compose up -d redis livekit ingress >"$RUN_DIR/docker.log" 2>&1; then
    warn "docker compose a échoué (voir .run/docker.log) : chat OK, vidéo indisponible."
    warn "Cause fréquente : utilisateur hors du groupe docker (sudo usermod -aG docker \$USER)."
  fi
else
  say "Docker introuvable : LiveKit ne tournera pas (chat OK, vidéo indisponible)."
fi

# --- Dépendances et contrats partagés ----------------------------------------
if [ "$NO_INSTALL" = 1 ]; then
  say "Installation sautée (--no-install)."
else
  say "Installation des dépendances…"
  pnpm install --frozen-lockfile >"$RUN_DIR/install.log" 2>&1 ||
    die "pnpm install a échoué. Voir .run/install.log"
fi

# Obligatoire AVANT le backend : il importe @solocast/shared depuis dist/, pas depuis les
# sources. Sans ce build, `tsx` échoue sur ERR_MODULE_NOT_FOUND et ne réessaie pas.
say "Build de @solocast/shared…"
pnpm --filter @solocast/shared build >"$RUN_DIR/shared.log" 2>&1 ||
  die "Build de shared échoué. Voir .run/shared.log"

# --- Origine publique (mode partage) -----------------------------------------
# Le tunnel démarre en premier : le backend a besoin de l'origine publique pour l'allowlist CORS.
PUBLIC_URL=""
if [ "$SHARE" = 1 ]; then
  : >"$TUNNEL_LOG"
  say "Ouverture du tunnel Cloudflare…"
  cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$SHARE_PORT" >"$TUNNEL_LOG" 2>&1 &
  PIDS+=("$!")

  for _ in $(seq 1 60); do
    PUBLIC_URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)"
    [ -n "$PUBLIC_URL" ] && break
    sleep 1
  done
  [ -n "$PUBLIC_URL" ] || die "Pas d'adresse de tunnel après 60 s. Voir .run/tunnel.log"

  # Une seule origine publique : le cookie de session et le WebSocket restent same-site.
  export CORS_ORIGIN="$PUBLIC_URL"
  export COOKIE_SECURE=true
  # Front servi derrière le proxy : API et WebSocket en relatif, donc même origine que la page.
  export NEXT_PUBLIC_API_BASE_URL=""
  export NEXT_PUBLIC_WS_URL="/ws"
else
  # Local : les deux serveurs ont chacun leur origine, le CORS doit nommer celle du front.
  export CORS_ORIGIN="http://localhost:$WEB_PORT"
  export COOKIE_SECURE=false
  # Dérivé du port réellement utilisé : un BACKEND_PORT personnalisé reste cohérent, alors que
  # apps/web/.env.local code 3000 en dur. L'environnement du processus l'emporte sur ce fichier.
  export NEXT_PUBLIC_API_BASE_URL="http://localhost:$BACKEND_PORT"
  export NEXT_PUBLIC_WS_URL="ws://localhost:$BACKEND_PORT/ws"
fi
export NEXT_PUBLIC_BACKEND_MODE=http

# --- Services ----------------------------------------------------------------
# BACKEND_HOST=0.0.0.0 : seul moyen pour le conteneur LiveKit (qui sort par la passerelle du pont
# Docker) d'atteindre /webhooks/livekit. Expose le backend au réseau local : sur demande explicite.
if [ "$WEBHOOK" = 1 ]; then
  export BACKEND_HOST=0.0.0.0
  warn "--webhook : le backend écoute sur 0.0.0.0, il est joignable depuis tout le réseau local."
fi

say "Démarrage du backend…"
# BACKEND_PORT doit venir de l'environnement : le .env (lu par --env-file) ne l'emporte pas sur
# une variable déjà exportée, donc le backend écoute bien le port attendu.
BACKEND_PORT="$BACKEND_PORT" \
  pnpm --filter @solocast/backend dev >"$RUN_DIR/backend.log" 2>&1 &
PIDS+=("$!")

say "Démarrage du front…"
WEB_PORT="$WEB_PORT" \
  pnpm --filter @solocast/web dev >"$RUN_DIR/web.log" 2>&1 &
PIDS+=("$!")

if [ "$SHARE" = 1 ]; then
  say "Démarrage du proxy mono-origine…"
  SHARE_PORT="$SHARE_PORT" BACKEND_PORT="$BACKEND_PORT" WEB_PORT="$WEB_PORT" \
    node "$ROOT/scripts/share-proxy.mjs" >"$RUN_DIR/proxy.log" 2>&1 &
  PIDS+=("$!")
fi

wait_for() { # URL, libellé, secondes, journal
  for _ in $(seq 1 "$3"); do
    curl -sf -o /dev/null --max-time 2 "$1" && return 0
    sleep 1
  done
  printf '\n\033[1;31m==>\033[0m %s n'"'"'a pas répondu. Dernières lignes de %s :\n\n' "$2" "$4" >&2
  tail -n 15 "$4" >&2
  exit 1
}

if [ "$SHARE" = 1 ]; then
  CHECK_BASE="http://127.0.0.1:$SHARE_PORT"
else
  CHECK_BASE_API="http://127.0.0.1:$BACKEND_PORT"
  CHECK_BASE="http://127.0.0.1:$WEB_PORT"
fi
wait_for "${CHECK_BASE_API:-$CHECK_BASE}/health" "Le backend" 60 "$RUN_DIR/backend.log"
wait_for "$CHECK_BASE/" "Le front" 120 "$RUN_DIR/web.log"

printf '\n'
say "Prêt."
if [ "$SHARE" = 1 ]; then
  printf '\n    Adresse à partager : \033[1;36m%s\033[0m\n' "$PUBLIC_URL"
  printf '    Studio (streameur) : \033[1m%s/studio\033[0m\n' "$PUBLIC_URL"
  printf '    \033[1;33mAdresse publique, sans mot de passe\033[0m : qui l'"'"'ouvre regarde, écrit, et peut prendre le studio.\n'
  printf '    (le chat n'"'"'accepte que cette origine : passer par l'"'"'adresse ci-dessus, pas par 127.0.0.1)\n'
else
  printf '\n    Direct  : \033[1;36mhttp://localhost:%s\033[0m\n' "$WEB_PORT"
  printf '    Studio  : \033[1mhttp://localhost:%s/studio\033[0m\n' "$WEB_PORT"
  printf '    API     : http://localhost:%s/health\n' "$BACKEND_PORT"
  printf '    Partager hors de cette machine : ./start.sh --share\n'
fi
printf '    Journaux : .run/{backend,web,proxy,tunnel,docker}.log\n\n'
say "Ctrl+C pour tout arrêter."

wait
