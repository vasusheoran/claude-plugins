---
name: kv
description: Use when reading or writing secrets in the homelab Vault's KV store — vault kv get/put/patch/list under secret/*. Reach for this whenever a task needs a homelab secret (bastion/, cloudflare/, operator/, homelab/, personal/) or has to add/update one.
---

# vault:kv

Everyday secret CRUD against the homelab Vault's KV-v2 store at `secret/`.

## When

Any task that reads or writes a homelab secret. Auth is per-identity: `vasu`'s OIDC
login carries `claude-write` (full `secret/*` CRUD). If a command 403s, the token
lapsed — re-run [[vault:auth]].

## Read

```bash
vault kv get secret/cloudflare/api            # full secret, all fields
vault kv get -field=token secret/cloudflare/api   # one field, raw (pipe-safe)
vault kv list secret/                          # keys under a path
```

## Write

```bash
vault kv patch secret/cloudflare/api token=NEW   # read-merge-write: keeps other fields
vault kv put   secret/cloudflare/api token=NEW   # CLOBBERS: replaces the whole secret
```

**Default to `patch`.** The real CLI's `patch` does a proper read-merge-write, so it
updates one field and leaves the rest intact. `put` overwrites every field — only use
it when you genuinely mean to replace the whole secret (or the path is new).

## Notes

- LAN only: `VAULT_ADDR=http://192.168.29.175:8200` (in `~/.zshrc`). Off-LAN, bring up
  Tailscale first — the public host 302s.
- Multi-line / file values: `vault kv patch secret/foo/bar key=@file.pem`.
- Never paste a fetched secret into chat unless the user asked to see it — use `-field`
  and pipe it where it's needed.
- Writing under paths that need root (policies, auth mounts) is NOT this skill — that's
  [[vault:privileged]]. Plain `secret/*` writes work with `claude-write`.
