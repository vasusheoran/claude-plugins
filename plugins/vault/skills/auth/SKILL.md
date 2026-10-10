---
name: auth
description: Use when a HashiCorp Vault CLI command against the homelab Vault fails with "permission denied", "invalid token", "token expired", or a 403 — the local OIDC token (8h TTL) has expired and needs re-authenticating. Also use to log in from a fresh machine that has never authenticated.
---

# vault:auth

Authenticate the local Vault CLI to the homelab Vault via Authentik OIDC (passkey).

## When

A `vault` command returns `permission denied`, `invalid token`, `Error making API
request ... 403`, or `token expired` — the stored OIDC token (8h TTL) has lapsed.
Or this machine has never logged in.

## Login

```bash
export VAULT_ADDR=http://192.168.29.175:8200   # already in ~/.zshrc; set if a fresh shell lacks it
vault login -method=oidc
```

Opens the browser to `auth.homelab.codeunbound.dev` for the Authentik passkey. On
success the token is stored in the CLI token helper — no `VAULT_TOKEN` export needed.
Expect policy `claude-write` (full `secret/*` CRUD), 8h TTL.

## Notes

- LAN only: `192.168.29.175:8200` (the public host 302s). Off-LAN, connect via Tailscale.
- `vault login` blocks waiting for the browser callback (localhost:8250). If driving
  from an agent, run it backgrounded and read the output file for the browser URL +
  success line.
- Verify: `vault token lookup` — check `ttl` and `policies`.
- The real CLI's `vault kv patch secret/...` does proper read-merge-write (unlike the
  Vault web UI's clobbering `write`).
