# Agents Manager

A local-first **control center for AI coding agents**. Agents Manager scans your machine for installed agents (Claude Code, Codex, OpenCode, OpenClaw), and lets you browse, edit, back up, diff, and (for selected kinds) deploy or sync their skills, MCP servers, agents, commands, hooks, plugins, and settings from one desktop app.

> **Status**: Safe Alpha — multi-agent scan, asset edit-with-backup, diff, local repository (skills / MCP servers / agents / commands / hooks), deploy of those kinds into agent config trees, encrypted snapshot sync, and live Claude session listing plus connected-backend status all work today. Plugin and `settings.json` deploy through the repository, remote repository sync, and broader hardening are still ahead.

## What it does today

- **Multi-agent scan** — Claude Code, Codex, and OpenCode are scanned natively; OpenClaw is detected via marker files only (adapter is an experimental stub, no real scan yet).
- **Asset edit with backup & revert** — every save writes a `.bak.<timestamp>` next to the original file and records a restorable snapshot. JSON / TOML are syntax-validated before write.
- **Diff view** — compare current files against any prior backup or snapshot.
- **Local repository** — keep curated **skills, MCP servers, agents, commands, and hooks** locally, independent of any single agent install. Plugins and settings files are scanned and editable in place but are **not** repository / deploy targets today.
- **Deploy (skills / MCP / agents / commands / hooks)** — push those repository kinds into a chosen agent's config tree, with backup before overwrite.
- **Encrypted snapshot sync** — bundle agent state into a tarball, encrypt with **AES-256-GCM** on the client (passphrase → scrypt-derived key), and upload as an opaque blob to a self-hostable backend. The server never sees your plaintext.
- **Sessions & backend status** — list live Claude Code sessions and show connected-backend health (`/api/health` + auth probe) from the desktop UI. The desktop app does **not** supervise or start the backend process for you.

## Supported agents

| Agent        | Detection | Scan         | Edit + backup | Deploy | Notes |
|--------------|-----------|--------------|---------------|--------|-------|
| Claude Code  | ✅        | ✅           | ✅            | ✅     | Skills, plugins, MCP, agents, commands, hooks, settings |
| Codex        | ✅        | ✅           | ✅            | ✅     | TOML config + agents |
| OpenCode     | ✅        | ✅           | ✅            | ✅     | |
| OpenClaw     | ✅ (marker) | ⚠ stub     | —             | —      | **Experimental** — adapter detects `SOUL.md` / `IDENTITY.md` only; real scan not implemented |

## Project layout

```
Agents-Manager/
├── desktop/    # Electron + React desktop client (MIT)
├── backend/    # self-hostable sync server (AGPL-3.0)
└── shared/     # cross-process TypeScript types
```

## Quick start

### Desktop

```bash
cd desktop
npm install
npm run dev          # electron-vite dev
npm run typecheck
npm run build
```

The app scans `~/.claude`, `~/.codex`, `~/.opencode`, and `~/.openclaw` for agents and shows whatever it finds. Editing is **off** by default — flip the switch in **Settings → Enable editing** before any write happens.

### Backend (optional, only for sync)

```bash
cd backend
cp .env.example .env
echo "AGENTS_MANAGER_API_KEY=$(openssl rand -base64 48)" >> .env
npm install
npm run typecheck
npm run build

# Run locally — the backend reads only from process.env (no dotenv loader),
# so you must export the .env values into the shell yourself:
set -a; source .env; set +a
npm run dev          # tsx watch

# …or run via Docker Compose, which reads .env automatically:
docker compose up -d
```

In the desktop **Sync** panel, paste the same `AGENTS_MANAGER_API_KEY` and the server URL. The desktop client encrypts each snapshot before upload; the server only stores opaque blobs.

## Security model

- **Local-first.** Scanning, editing, diffing, and deploy all happen on your machine. Nothing leaves the device unless you explicitly use Sync.
- **Backup before write.** Every edit produces a `.bak.<timestamp>` and a restorable snapshot in the local DB.
- **Editing is opt-in.** Off by default; toggle in Settings.
- **Client-side encryption for sync.** AES-256-GCM with a scrypt-derived key from your passphrase. The backend never has the passphrase or the plaintext — it only stores opaque blobs and metadata.
- **Lose the passphrase → lose the snapshots.** Server admin cannot recover encrypted blobs.

## Why this exists

Heavy users of multiple AI coding agents juggle skills, plugins, MCP servers, agents, commands, hooks, and settings across `~/.claude`, `~/.codex`, `~/.opencode`, and friends. There is no unified inventory, no diff between machines, no safe edit-with-backup, no curated personal repository to deploy from. Agents Manager fills that gap, locally and under your control.

## Roadmap

- **Safe Alpha hardening (current)** — tighten scan/edit error paths, expand test coverage, audit IPC and write boundaries.
- **Repository & Deploy polish** — richer item metadata, conflict / merge UX, dry-run deploys.
- **Observability** — structured logs, session timeline, sync/deploy history, backend health surface.
- **Team & Marketplace** — shared repositories, signed bundles, multi-user backend roles.
- **OpenClaw adapter** — promote from stub to full scan/edit parity once the upstream layout stabilizes.

## License

- `desktop/` — MIT
- `backend/` — AGPL-3.0-or-later
