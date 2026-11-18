# Notion OAuth worker

A Cloudflare Worker at `https://ok-notion-oauth.identity16.workers.dev` that holds the Notion OAuth client secret. Notion's token endpoint requires the secret for the code exchange, every refresh, and revocation, so a local OpenKnowledge server cannot talk to it directly.

## Routes

| Route | Caller | What it does |
|---|---|---|
| `GET /oauth/notion/callback?code&state` | Notion, through the user's browser | Exchanges the code for a token and parks the result in a Durable Object named after `state` for five minutes. `error=…` is parked as a refusal. |
| `POST /oauth/notion/redeem {state, verifier}` | Local server, polling | Answers `202 {"status":"pending"}` until the callback lands, then hands over the parked result once and deletes it. |
| `POST /oauth/notion/refresh {refresh_token}` | Local server | Forwards the refresh to Notion with the client secret and relays Notion's answer. |
| `POST /oauth/notion/revoke {token}` | Local server | Revokes an access token on Notion with the client secret, so disconnecting a workspace ends the grant. |

`state` is `<nonce>.<challenge>`: two 43-character base64url parts, where `challenge` is the base64url SHA-256 of `verifier`. The local server keeps `verifier` to itself, so only the server that started the flow can redeem the token.

Each `state` gets its own `GrantVault` Durable Object, so a grant written by the callback is readable on the next poll. Workers KV was used first, but it caches a missing key at the edge for about a minute, so a server polling before the user approved waited that long after approval. An alarm deletes the grant at its expiry, and reads past the expiry return nothing even before the alarm fires.

## Cloudflare resources

All on the `joon-personal` account (`a89cb3cabef6bff4e68320d16e9af622`):

- Worker `ok-notion-oauth` on the `identity16.workers.dev` subdomain
- Durable Object class `GrantVault` (SQLite storage), bound as `GRANTS`
- Secrets `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET`

## Deploy

The deploy token lives in the macOS keychain as service `cloudflare-workers-deploy`, account `joon`, scoped to the `joon-personal` account.

```sh
cd packages/notion-oauth-worker
CLOUDFLARE_API_TOKEN="$(security find-generic-password -s cloudflare-workers-deploy -a joon -w)" pnpm run deploy
```

Set or rotate a secret the same way with `pnpm dlx wrangler@4 secret put NOTION_CLIENT_SECRET`.
