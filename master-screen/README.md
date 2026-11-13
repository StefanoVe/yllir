# Yllir master screen

Local web app for the game master: chat with the assistant, read the campaign, see and undo recent changes. One Node.js process per campaign, bound to 127.0.0.1.

## Live table

The live table (`/live`) is the cockpit imported from the author's prototype: a board where the assistant arranges the cards of the scene, the session log, and the combat overlay (initiative, battle map with draggable tokens, stats on hover, and a chat). The combat overlay has its own assistant session per fight, with only the combat tools. The cockpit code is in `server/src/cockpit/` (agent tools, turns, store, MCP endpoint, prompt), its adapters to this server and the framework are in `server/src/cockpit-host/`, the battle endpoints are in `server/src/routes/battle.ts`, and the client is in `client/src/app/cockpit/` (the combat overlay is in its `combat/` folder). The log and the combat are kept by the framework libraries; sheets created at the table go through the engine. `API.md` section "Live table (cockpit)" has the details.

## Folders

- `server/`: Node.js and Express server (TypeScript). Reads the campaign only through the framework engine.
- `client/`: Angular client, served by the server from `public/`.
- `shared/`: TypeScript types shared by server and client (from `API.md`).
- `dist/`: server build output (`dist/server.mjs`), not committed.

`API.md` is the contract between server and client. Read it before changing either side.

## Commands

In `server/`: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run dev`.

Run the built server: `node dist/server.mjs --campaign <campaign folder> --framework <yllir folder> [--port N] [--open]`.

Build notes: Critical CSS inlining is off: its onload handler is blocked by the server's script-src 'self' policy.

## Release

- `VERSION` holds the full version `MAJOR.MINOR.PATCH`. The developer sets it by hand in the commit, together with the pin in `yllir/master-screen.json` (same version, release URL). CI checks that the two agree and fails otherwise. `scripts/version.sh` prints the version and fails unless it has exactly three numeric parts.
- `scripts/pack.sh <version> <outdir>` builds `yllir-master-screen-<version>.tar.gz` (root: `server.mjs`, `public/`, `VERSION`) from `dist/server.mjs` and `client/dist/client/browser`. The bytes are deterministic; CI packs twice and compares.
- `.github/workflows/master-screen.yml` checks that `yllir/master-screen.json` matches `VERSION` (on every event), builds and packs the package, and on push to main publishes the GitHub Release `master-screen-v<version>` with two assets: `yllir-master-screen-<version>.tar.gz` and `yllir-master-screen-<version>.tar.gz.sha256`. CI never commits or edits files: `VERSION` and the pin are edited by the developer in the commit. If the release already exists, CI prints a warning and skips the upload; bump the version in the commit to publish a new one. The launcher downloads the package from the pin and checks it against the `.sha256` asset.
