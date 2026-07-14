# vibeboard

VibeBoard is a dark desktop board for organizing AI coding tasks across projects.

## Development

Development is local. It does not use GitHub releases or downloaded builds.

```bash
npm install
npm run dev
```

The dev command starts Electron with Vite, so renderer changes reload while the app is running.

Local package checks:

```bash
npm run package:local
npm run dist:local
```

`package:local` creates an unpacked app in `release/`. `dist:local` creates local installers and never publishes to GitHub.

## Release

Push a version tag to build Windows and macOS installers and publish a GitHub Release.

```bash
git tag v0.1.0
git push origin v0.1.0
```
