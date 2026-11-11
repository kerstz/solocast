# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage
[SemVer](https://semver.org/lang/fr/).

## [Unreleased]

### Sécurité

- Launcher : le proxy du tunnel ne plante plus quand un client coupe (RST) pendant l'upgrade
  WebSocket (exception non rattrapée, arrêt du studio) ; segments `.` / `..` refusés (`/rtc/../…`).
- Un viewer banni, ou dont la parole a été retirée, ne peut plus rejoindre le SFU avec un jeton
  LiveKit encore valide : contrôle sur le webhook `participant_joined`, fail-closed si `permission` est absente, avec application d'un grant en attente et gestion de la course avec `/api/stage/grant`.
- Ban par IP, rate-limit et plafond WebSocket sur le préfixe /64 en IPv6 (rotation de suffixe sans effet) ; IPv4 mappée en hexadécimal ramenée à l'IPv4.
  Transition : les bans IPv6 posés avant cette version (empreinte de l'adresse complète, 24 h au plus) ne sont pas appariés ; ils expirent seuls, et un viewer reconnecté est ré-empreinté en /64.
- `TRUST_PROXY_HOPS` : seul le nombre de proxys configuré est cru pour `X-Forwarded-For`
  (avant : toute la chaîne, donc usurpation du rate-limit et du ban par IP).
- Pseudos réservés (`Streameur`, `admin`, `system`…), aussi ignorés dans les jetons viewer déjà émis.
- Dépendances : fast-uri 3.1.9 / 4.2.3, glob 14, minimatch 11, vite 8.3.8 (GHSA-333x-w4r6-6crp,
  GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, GHSA-xhq7-xmqj-769h, GHSA-3g3m-2fjr-6pw4,
  GHSA-g3hv-75wg-m249, GHSA-587h-7wmj-h5pm et autres vite) ; fastify 5.12.8, eslint 10.14.

### Ajouté

- Arrêt propre borné à 10 s du backend (`createShutdown`) ; un second signal force la sortie.
- `CHANGELOG.md`, `.gitleaksignore` (faux positifs de tests), Dependabot pour les actions GitHub.
- CI : build web, `pnpm audit --audit-level high` aussi sur les dépendances de développement (avertissement, non bloquant ; la production reste bloquante),
  `persist-credentials: false`.

### Modifié

- Node >= 22 déclaré dans `engines`.
- Compose : Redis en lecture seule sans capability, LiveKit sans capability.
- Le store mémoire purge clés et places expirées par un timer d'une minute.
- Le cookie studio reste en `SameSite=Lax` (Strict essayé puis annulé : il cassait la navigation inter-sites sans gain, l'origine étant déjà contrôlée).
