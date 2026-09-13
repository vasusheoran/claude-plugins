---
name: privileged
description: Use when a Vault op needs root, not claude-write — policy create/update/delete, auth-method or secrets-engine mount/tune/unmount, or any sys/ admin path. OIDC login only grants claude-write, so these fail with permission denied; this skill covers getting a short-lived root token via the file-staging handoff instead of pasting root into chat.
---

# vault:privileged

Root-only Vault administration — policies, auth methods, mounts, `sys/*`.

## When

The op touches Vault's own config, not just secret data:

- `vault policy write/delete ...`
- `vault auth enable/disable/tune ...`
- `vault secrets enable/disable/tune ...`
- most `vault write sys/...`

These need a `root` policy. The OIDC login carries `claude-write` (full `secret/*`
CRUD) but **not** root, so they return `permission denied`. Everyday `secret/*` reads
and writes do NOT belong here — that's [[vault:kv]].

## Get a root token — via file staging, never chat

Root tokens must not land in the conversation. The user mints one and stages it in a
file; the agent reads it from there, uses it, then revokes it ([[vault:revoke]]).

1. Ask the user to mint a short-lived root token and stage it, per the handoff in
   `homelab/docs/vault-secrets.md`:

   ```bash
   # user runs this against an already-privileged session
   vault write auth/token/create policies=root ttl="5m" -field=token > /tmp/vault-root && chmod 600 /tmp/vault-root
   ```

2. Use it for the single op, scoped to this shell only (don't overwrite the stored
   OIDC token):

   ```bash
   VAULT_TOKEN="$(cat /tmp/vault-root)" vault policy write my-policy my-policy.hcl
   ```

3. Revoke and remove it when done:

   ```bash
   VAULT_TOKEN="$(cat /tmp/vault-root)" vault token revoke -self && rm -f /tmp/vault-root
   ```

## Notes

- Keep the TTL short (5m) — it's a one-shot for the specific admin op, not a session.
- Never `export VAULT_TOKEN=<root>` globally and never echo it; use the inline
  `VAULT_TOKEN="$(cat ...)"` form so it stays out of history and env dumps.
- If the op turns out to only touch `secret/*`, stop — you didn't need root; use
  [[vault:kv]] with the normal OIDC token.
