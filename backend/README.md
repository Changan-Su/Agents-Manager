# Agents Manager — Backend

Self-hostable sync server for the Agents Manager desktop app.

- **Stack**: Node 22 + Fastify + better-sqlite3
- **Auth**: master API key (single tenant), per-machine namespacing
- **Storage**: local filesystem by default, S3 driver planned
- **License**: AGPL-3.0-or-later (see ../LICENSE-backend)

The server only stores opaque blobs — it never parses your agent configs and
never sees the encryption passphrase. The desktop client encrypts each
snapshot with AES-256-GCM (passphrase-derived key via scrypt) before uploading.

## Quick start

```bash
cp .env.example .env
# Generate a master key:
echo "AGENTS_MANAGER_API_KEY=$(openssl rand -base64 48)" >> .env
docker compose up -d
curl http://localhost:8787/api/health
```

In the desktop app, open **Sync** and paste the same `AGENTS_MANAGER_API_KEY`
together with the server URL. There's no registration or password — anyone
holding the key has full read/write access.

## Endpoints

```
GET    /api/health                                       service health
POST   /api/blobs                  multipart upload      → { blobId, sizeBytes, sha256 }
GET    /api/blobs/:id              binary stream
DELETE /api/blobs/:id
POST   /api/snapshots              { blobId, machineLabel, manifest, ... }
GET    /api/snapshots[?machineId=]
GET    /api/snapshots/:id
DELETE /api/snapshots/:id
GET    /api/machines                                     list known machines
GET    /api/repository[?kind=]                           list repository items
POST   /api/repository             { kind, name, blobId, manifest }
GET    /api/repository/:id
DELETE /api/repository/:id
```

Every route except `/api/health` requires:

- `X-Api-Key: <AGENTS_MANAGER_API_KEY>`
- `X-Machine-Id: <stable-uuid-from-client>`  *(used to partition data so multiple
  devices on one server don't see each other's blobs)*

## Configuration

See [`.env.example`](./.env.example) for the full list. Required:
`AGENTS_MANAGER_API_KEY` (≥32 characters; the server refuses to start without it).

## Development

```bash
npm install
npm run dev      # tsx watch
npm run typecheck
npm run build
```

The `dev` server uses an SQLite file at `./data/app.db`. Wipe and restart with
`rm -rf data && npm run dev`.

> **Migrating from v0.3 (JWT auth)**: drop the old database — the schema is
> incompatible. There's no automatic migration because we no longer have
> `users` and the old `user_id` columns are gone.

## Deployment notes

- Mount `/data` as a persistent volume — that's where SQLite + blobs live.
- Put a TLS-terminating reverse proxy (Caddy/nginx/Traefik) in front.
- Rotate the API key by updating `AGENTS_MANAGER_API_KEY` and restarting; the
  desktop client will surface a 401 and prompt for the new value.
- Set `CORS_ORIGIN` only if you'll talk to this server from a browser; the
  Electron client doesn't need it.

## Security model

- The master key is compared with `crypto.timingSafeEqual` to avoid leaking
  information through string-comparison timing.
- Blobs are AES-256-GCM-encrypted on the client. Server never has the key.
- Lose your passphrase → lose your snapshots. Server admin cannot recover them.

If a snapshot fails to decrypt after restore, suspect:
1. wrong passphrase
2. blob corruption (compare `sha256` from `/api/snapshots/:id` vs local hash)

## License

AGPL-3.0-or-later — running this server modified, on the public internet, means
you must publish your modifications under the same license. Use the desktop
client (MIT) freely.
