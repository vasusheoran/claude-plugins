---
name: revoke
description: Use to revoke a Vault token or secret lease on the homelab Vault — tearing down a short-lived root token after a privileged op, killing a leaked or rotated credential, or invalidating a dynamic secret. Covers token revoke (self / by accessor) and lease revoke (single / by prefix).
---

# vault:revoke

Invalidate a Vault token or lease immediately.

## When

- A short-lived root token from [[vault:privileged]] finished its job — revoke it now,
  don't wait for the TTL.
- A token or dynamic credential leaked or was rotated and must die immediately.
- Cleaning up leases from a dynamic secrets engine.

## Revoke a token

```bash
# the token you're currently using (e.g. the staged root token)
VAULT_TOKEN="$(cat /tmp/vault-root)" vault token revoke -self

# a specific token, without knowing its value — by accessor
vault token revoke -accessor <accessor>
```

Find accessors with `vault list auth/token/accessors` (needs privilege).

## Revoke a lease

```bash
vault lease revoke <lease_id>              # one dynamic-secret lease
vault lease revoke -prefix secret/data/…   # every lease under a prefix
```

## Notes

- `-self` revokes the token in `VAULT_TOKEN` (or the CLI token helper) — don't run it
  with your own OIDC token loaded unless you mean to log yourself out.
- Revocation is immediate and cascades to child tokens.
- After revoking a staged root token, `rm -f` the file it came from.
