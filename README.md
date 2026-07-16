# VibeBoard

VibeBoard is a dark desktop app for organizing AI coding work across multiple projects. It treats each project as its own board, and each AI agent run as a task card that can move through custom lanes.

The goal is to make agent work easier to track than a single chat list or IDE sidebar. A project gets a board. A board gets lanes. A task contains the prompt history, agent output, and code changes in one place.

## Current Scope

VibeBoard is an Electron MVP focused on local project organization and Cursor Agent integration.

- Project-based tabs, where a tab maps to a project folder.
- Custom board lanes for each project.
- Task cards with status indicators for idle, running, attention, and done states.
- Task detail modal with chat on the left and formatted code changes on the right.
- Local persistence through SQLite.
- Cursor Agent execution through the installed `agent` CLI.
- GitHub release builds for Windows and macOS.
- Auto-update support through GitHub Releases in packaged builds.

## Tech Stack

| Area | Choice |
| --- | --- |
| Desktop shell | Electron |
| Build tooling | Electron Vite |
| UI | React, TypeScript |
| Local data | SQLite with `better-sqlite3` |
| Drag and drop | `dnd-kit` |
| Icons | `lucide-react` |
| Packaging | `electron-builder` |
| Releases | GitHub Actions, `git-cliff`, `softprops/action-gh-release` |

## Development

Install dependencies:

```bash
npm install
```

Run the app locally:

```bash
npm run dev
```

This starts Electron through Vite. You do not need GitHub releases or downloaded installers for development.

Test the update UI locally:

```bash
npm run dev:update
```

This runs the same dev app with a mocked update available. The banner, progress bar, restart action, and release notes can be tested without downloading a GitHub release.

Reset local app data:

```bash
npm run reset:data
```

Run checks:

```bash
npm run typecheck
npm run lint
npm run build
```

Run a local packaged build:

```bash
npm run package:local
```

Create local installers without publishing:

```bash
npm run dist:local
```

## Cursor Agent

VibeBoard does not control the Cursor editor UI. It runs Cursor Agent in the selected project folder through the `agent` command.

Expected setup:

1. Install Cursor.
2. Install or enable Cursor Agent CLI.
3. Run `agent login` if Cursor asks for authentication.
4. Create a VibeBoard project pointing at the local repository folder.
5. Send a task message from VibeBoard.

If the agent command is missing or not authenticated, VibeBoard shows setup actions in the sidebar.

## Releases

Releases are created from version tags:

```bash
git tag v0.1.4
git push origin v0.1.4
```

The release workflow builds:

- Windows installer: `.exe`
- macOS installer: `.dmg`
- updater metadata: `latest.yml`, `latest-mac.yml`, blockmaps

Release notes are generated from conventional commits with `git-cliff`.

## Auto Updates

Packaged builds check GitHub Releases for newer versions. When an update is available, VibeBoard shows an update control in the sidebar. The app does not show manual update controls when no update exists.

During development, `npm run dev:update` uses a local mocked update flow so the updater UI can be tested without installing a release build.

On macOS, unsigned or ad-hoc signed builds open the GitHub release page instead of attempting an in-app install. Fully automatic macOS updates require a properly signed release. Windows packaged builds use the normal in-app updater path.

## Design Rules

VibeBoard follows a restrained dark desktop design.

- Dark mode only.
- No decorative gradients.
- No emoji.
- Icons come from `lucide-react`.
- Copy should be functional, not instructional filler.
- Controls should be compact, predictable, and consistent.

## Repository Layout

```text
src/main       Electron main process, database, Cursor runner
src/preload    Safe renderer API bridge
src/renderer   React UI
src/shared     Shared TypeScript types
scripts        Local utility scripts
.github        Release workflow
```

## Notes for Contributors

- Keep Electron main, preload, and renderer boundaries explicit.
- Prefer typed IPC inputs and outputs through `src/shared/types.ts`.
- Do not bypass the preload bridge from the renderer.
- Keep app data local unless a feature explicitly requires a remote service.
- Validate changes with typecheck, lint, and production build before tagging.
