# VibeBoard

A dark desktop kanban board for organizing AI coding work across multiple projects.

VibeBoard is built for developers who run AI agents on real codebases and need more structure than a single chat thread or IDE sidebar. Each repository gets its own board. Each agent run becomes a task card you can move through custom lanes, inspect, and follow to completion.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)](https://github.com/YeeetSK/vibeboard/releases)

## Screenshot

![VibeBoard main board view](https://i.imgur.com/8WixgG8.png)

## Why VibeBoard?

When you work with AI agents across several repos, context gets scattered fast. Prompts, outputs, and code changes live in different places, and it is hard to see what is running, what needs attention, and what is done.

VibeBoard keeps agent work in one place per project:

- **Boards per project**: tabs map to local folders; each project has its own lanes and tasks.
- **Task cards with status**: idle, running, needs attention, and done states at a glance.
- **Full task history**: chat, agent output, and formatted diffs in a single detail view.
- **Cursor Agent integration**: send work to the installed `agent` CLI in the selected repo.
- **Local-first**: SQLite persistence on your machine; no cloud account required for core use.
- **Git-aware runs**: optional branch or worktree modes so agents can work in isolation.

## Features

| Area | What you get |
| --- | --- |
| Organization | Project tabs, custom lanes, drag-and-drop task cards |
| Agent runs | Cursor Agent via CLI, run modes (shared / branch / worktree) |
| Task detail | Split view: conversation on the left, syntax-highlighted changes on the right |
| Notifications | Desktop alerts when tasks need attention or finish |
| Updates | Auto-update from GitHub Releases in packaged builds (Windows + macOS) |
| Design | Restrained dark UI: compact controls, Lucide icons, no decorative noise |

## Download

Pre-built installers are published on [GitHub Releases](https://github.com/YeeetSK/vibeboard/releases):

- **macOS**: `.dmg` (Intel and Apple Silicon)
- **Windows**: `.exe` installer

You need [Cursor](https://cursor.com) and the Cursor Agent CLI for agent execution. VibeBoard guides you through setup if the CLI is missing or not logged in.

## Quick start

1. Download and install VibeBoard from [Releases](https://github.com/YeeetSK/vibeboard/releases).
2. Install [Cursor](https://cursor.com) and ensure the `agent` CLI is available (`agent login` if prompted).
3. In VibeBoard, add a project pointing at a local repository folder.
4. Create a task, pick a lane, and send your prompt.

The agent runs in that project folder. Progress and changes show up on the task card and in the detail modal.

## Development

**Requirements:** Node.js, npm, and a machine that can build native modules (`better-sqlite3`).

```bash
git clone https://github.com/YeeetSK/vibeboard.git
cd vibeboard
npm install
npm run dev
```

`npm run dev` starts Electron through Vite. You do not need release installers for local development.

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the app in development |
| `npm run dev:update` | Dev app with mocked updater UI |
| `npm run reset:data` | Clear local SQLite app data |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run package:local` | Local packaged app (no publish) |
| `npm run dist:local` | Local installers without publishing |

## Cursor Agent setup

VibeBoard does not drive the Cursor editor UI. It runs Cursor Agent in the selected project directory through the `agent` command.

1. Install Cursor.
2. Install or enable the Cursor Agent CLI.
3. Run `agent login` if authentication is required.
4. Add the repo as a VibeBoard project.
5. Send a message from a task.

If the CLI is missing or not authenticated, setup actions appear in the sidebar.

## Tech stack

| Layer | Choice |
| --- | --- |
| Desktop | Electron |
| Build | Electron Vite |
| UI | React, TypeScript |
| Data | SQLite (`better-sqlite3`) |
| Drag and drop | `@dnd-kit` |
| Packaging | `electron-builder` |
| Releases | GitHub Actions, `git-cliff` |

## Repository layout

```text
src/main       Electron main process, database, Cursor runner
src/preload    Safe renderer ↔ main IPC bridge
src/renderer   React UI
src/shared     Shared TypeScript types
scripts        Local utility scripts
.github        CI and release workflow
```

## Releases and auto-update

Tagged versions trigger release builds:

```bash
git tag v0.1.15
git push origin v0.1.15
```

Packaged apps check GitHub Releases for updates. On macOS, unsigned or ad-hoc signed builds open the release page in the browser instead of installing in-app; fully automatic macOS updates need a properly signed release.

Use `npm run dev:update` to exercise the updater UI without a release build.

## Contributing

Contributions are welcome. Please keep changes focused and run checks before opening a PR:

```bash
npm run typecheck
npm run lint
npm run build
```

Guidelines:

- Keep Electron main, preload, and renderer boundaries explicit.
- Use typed IPC through `src/shared/types.ts`.
- Do not call Node or filesystem APIs directly from the renderer.
- Prefer local data unless a feature explicitly needs a remote service.

Use the issue and PR templates under `.github/` when reporting bugs or proposing features.

## License

MIT. See `package.json`.
