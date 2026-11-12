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

`yllir/master-screen/` is written only by CI (`.github/workflows/master-screen.yml`). Do not edit it by hand.
