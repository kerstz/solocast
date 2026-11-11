# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage
[SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Sécurité

- Launcher : le proxy du tunnel ne plante plus quand un client coupe (RST) pendant l'upgrade
  WebSocket (exception non rattrapée, arrêt du studio) ; segments `.` / `..` refusés (`/rtc/../…`).
- Un viewer banni, ou dont la parole a été retirée, ne peut plus rejoindre le SFU avec un jeton
  LiveKit encore valide : contrôle sur le webhook `participant_joined`.
- Ban par IP sur le préfixe /64 en IPv6 (rotation de suffixe sans effet).
- `TRUST_PROXY_HOPS` : seul le nombre de proxys configuré est cru pour `X-Forwarded-For`
  (avant : toute la chaîne, donc usurpation du rate-limit et du ban par IP).
- Cookie studio en `SameSite=Strict`.
- Pseudos réservés (`Streameur`, `admin`, `system`…).
- Dépendances : fast-uri 3.1.9 / 4.2.3, glob 14, minimatch 11, vite 8.3.8 (GHSA-333x-w4r6-6crp,
  GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, GHSA-xhq7-xmqj-769h, GHSA-3g3m-2fjr-6pw4,
  GHSA-g3hv-75wg-m249, GHSA-587h-7wmj-h5pm et autres vite) ; fastify 5.12.8, eslint 10.14.

### Ajouté

- Arrêt propre borné à 10 s du backend (`createShutdown`).
- `CHANGELOG.md`, `.gitleaksignore` (faux positifs de tests), Dependabot pour les actions GitHub.
- CI : build web, `pnpm audit --audit-level high` aussi sur les dépendances de développement,
  `persist-credentials: false`.

### Modifié

- Node >= 22 déclaré dans `engines`.
- Compose : Redis en lecture seule sans capability, LiveKit sans capability.
- Le store mémoire purge les clés expirées au fil des écritures.
