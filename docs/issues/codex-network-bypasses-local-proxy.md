# Codex network requests bypass the local proxy

Status: Implemented; owner verification pending

## Symptom

Codex browser authorization reaches Bitterless on `localhost:1455`, but the following token
exchange fails with OpenAI's unsupported-country response after the owner changes local proxy
software or routing mode. The same OAuth flow works with another proxy configuration.

## Evidence

- The production log records the IPv6 callback, a matching authorization `code`/`state`, and a
  successful callback response before the token exchange fails.
- The affected Bitterless process has no proxy environment variables.
- A request using the macOS system HTTP proxy exits through Japan, while an explicit direct request
  exits through China.
- Bitterless embeds Pi as a library. Its Codex login and runtime therefore do not consume the Codex
  CLI's `~/.codex/config.toml` network configuration.

The loopback callback is healthy. The failure is caused by outbound Codex traffic taking a direct
route that differs from the browser's proxied route.

## Accepted resolution

Use two independent defenses:

1. Clash Verge enables strict TUN routing for process traffic, routes the Bitterless process family
   and OpenAI domains through `PROXY`, and excludes `127.0.0.0/8` plus `::1/128` so OAuth callbacks
   remain local.
2. Bitterless reads an optional profile-local `cowork/pi/settings.json` and installs its declared
   loopback HTTP proxy before loading the embedded Pi module. This covers both OAuth token exchange
   and authenticated model requests without mutating process environment variables.

An absent Bitterless proxy file preserves the platform/default route. A present but invalid file
fails closed for Codex operations and writes only sanitized configuration diagnostics.
