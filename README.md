# Agents Manager

A desktop app that auto-scans your machine for installed AI coding agents (Claude Code, Codex, OpenCode, OpenClaw) and gives you one place to browse, edit, and back up their skills, plugins, MCP servers, agents, and settings.

> **Status**: Sprint 1 — local read-only inventory. Edit + sync arrive in Sprint 2 / 3.

## Project layout

```
apps/Agents-Manager/
├── desktop/    # Electron + React desktop client (MIT)
├── backend/    # self-hostable sync server (AGPL-3.0, arrives Sprint 3)
└── shared/     # cross-process TypeScript types
```

## Quick start (desktop)

```bash
cd desktop
npm install
npm run dev
```

The app will scan `~/.claude`, `~/.codex`, `~/.opencode`, and `~/.openclaw` for agents and display whatever it finds. Read-only by default — nothing is written to your agent configs in Sprint 1.

## Why this exists

Heavy users of multiple AI coding agents juggle skills, plugins, MCP servers, and settings across `~/.claude`, `~/.codex`, `~/.opencode` and friends. There is no unified inventory, no diff between machines, no safe edit-with-backup. Agents Manager fills that gap.

## Roadmap

- **Sprint 1 (this release)** — Electron scaffold · Claude Code adapter · Dashboard · Read-only browsing
- **Sprint 2** — Codex / OpenCode / OpenClaw adapters · Edit-with-backup · Diff view
- **Sprint 3** — Self-hostable backend (Docker) · Encrypted snapshot upload · Multi-machine restore

## License

- `desktop/` — MIT
- `backend/` — AGPL-3.0 (when published)
