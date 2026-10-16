# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub private vulnerability
reporting instead: on the repository `kerstz/solocast`, open the **Security** tab, then
**Report a vulnerability** (Security Advisories). Include the version, the mode (installed or
server), the steps to reproduce and the impact. No email address is used for reports.

This is a small project maintained on a best-effort basis: expect an acknowledgement, not an SLA.

## Supported versions

Only the latest [release](../../releases) receives security fixes. Please reproduce on it before
reporting.

## Threat model

SoloCast is built for one streamer and a small group of viewers. There are no accounts; a viewer
is identified by a chosen username.

**Installed mode (.exe / .deb).**

- The studio is reserved to the local machine; viewers can only watch and chat.
- The local proxy listens on `127.0.0.1` only.
- The Cloudflare tunnel (`trycloudflare.com`) is optional, off by default, and exposes the site and
  the chat, not the studio.

**Server mode (Docker / public host).**

- The studio is reachable over the network, so it requires a key by default
  (`STUDIO_ACCESS=key`, `STUDIO_KEY` of at least 32 bytes, for example `openssl rand -hex 32`).
- `STUDIO_ACCESS=local` is only accepted on a loopback `BACKEND_HOST` with `TRUST_PROXY=false`;
  otherwise the backend refuses to start.
- Treat the studio key like a password and rotate it if it leaks.

**Out of scope.** Anyone with local access to the machine running the installed app, and a
compromised host or browser.
