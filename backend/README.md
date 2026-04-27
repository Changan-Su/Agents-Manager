# Agents Manager — Backend

Self-hostable backup & sync server for the Agents Manager desktop app.

- **Stack**: Node 22 + Fastify + better-sqlite3 + JWT
- **Storage**: local filesystem by default, S3 driver planned
- **License**: AGPL-3.0-or-later (see ../LICENSE-backend)

The server only stores opaque blobs — it never parses your agent configs and
never sees the encryption passphrase. The desktop client encrypts each
snapshot with AES-256-GCM (passphrase-derived key via scrypt) before uploading.

## Quick start

```bash
cp .env.example .env
# edit .env: set JWT_SECRET to something strong
docker compose up -d
curl http://localhost:8787/api/health
```

The first user that registers becomes admin. After that, set
`ALLOW_REGISTRATION=true` in `.env` to allow further sign-ups, or leave it off
for a single-user install.

## Endpoints

```
POST   /api/auth/register          { email, password }   → first user becomes admin
POST   /api/auth/login             { email, password }   → { token }
GET    /api/auth/me                                       → current user
POST   /api/blobs                  multipart upload      → { blobId, sizeBytes, sha256 }
GET    /api/blobs/:id              binary stream
DELETE /api/blobs/:id
POST   /api/snapshots              { blobId, machineId, machineLabel, manifest, ... }
GET    /api/snapshots[?machineId=]
GET    /api/snapshots/:id
DELETE /api/snapshots/:id
GET    /api/machines               list this user's machines
GET    /api/health                 service health
```

All endpoints under `/api/blobs`, `/api/snapshots`, `/api/machines`, and
`/api/auth/me` require a `Authorization: Bearer <token>` header.

## Configuration

See [`.env.example`](./.env.example) for the full list. Required in production:
`JWT_SECRET` (anything other than the default placeholder).

## Development

```bash
npm install
npm run dev      # tsx watch
npm run typecheck
npm run build
```

The `dev` server uses an SQLite file at `./data/app.db`. Wipe and restart with
`rm -rf data && npm run dev`.

## Deployment notes

- Mount `/data` as a persistent volume — that's where SQLite + blobs live.
- Put a TLS-terminating reverse proxy (Caddy/nginx/Traefik) in front.
- Set `CORS_ORIGIN` only if you'll talk to this server from a browser; the
  Electron client doesn't need it.

## Security model

- Passwords are bcrypt-hashed (cost 12).
- JWTs are signed with `JWT_SECRET`, expire after 30 days.
- Blobs are AES-256-GCM-encrypted on the client. Server never has the key.
- Lose your passphrase → lose your snapshots. Server admin cannot recover them.

If a snapshot fails to decrypt after restore, suspect:
1. wrong passphrase
2. blob corruption (compare `sha256` from `/api/snapshots/:id` vs local hash)

## License

AGPL-3.0-or-later — running this server modified, on the public internet, means
you must publish your modifications under the same license. Use the desktop
client (MIT) freely.
