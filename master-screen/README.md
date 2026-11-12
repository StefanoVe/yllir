# Yllir master screen

Local web app for the game master: chat with the assistant, read the campaign, see and undo recent changes. One Node.js process per campaign, bound to 127.0.0.1.

## Folders

- `server/`: Node.js and Express server (TypeScript). Reads the campaign only through the framework engine.
- `client/`: Angular client, served by the server from `public/`.
- `shared/`: TypeScript types shared by server and client (from `API.md`).
- `dist/`: server build output (`dist/server.mjs`), not committed.

`API.md` is the contract between server and client. Read it before changing either side.

## Commands

In `server/`: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run dev`.

Run the built server: `node dist/server.mjs --campaign <campaign folder> --framework <yllir folder> [--port N] [--open]`.

## Release

- `VERSION` holds `MAJOR.MINOR` (edit it by hand to change the line). CI appends the number of commits that touched `master-screen/`: `scripts/version.sh` prints the result.
- `scripts/pack.sh <version> <outdir>` builds `yllir-master-screen-<version>.tar.gz` (root: `server.mjs`, `public/`, `VERSION`) from `dist/server.mjs` and `client/dist/client/browser`. The bytes are deterministic; CI packs twice and compares.
- On push to main, `.github/workflows/master-screen.yml` publishes the GitHub Release `master-screen-v<version>` with the package as its only asset, then writes `yllir/master-screen.json` (version, sha256, url, size) and bumps the patch of `yllir/.claude-plugin/plugin.json`. The launcher downloads the package from that pin. Nothing under `yllir/` is built or committed by hand.
