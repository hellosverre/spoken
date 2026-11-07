# Spoken

**Du skriver, vi snakker.** You type what you need, and an AI makes the phone call for you. It says it's an AI, shows every word live, and asks you before it agrees to a price, a time or a booking. You can send it new instructions mid-call.

Built for Deaf and nonspeaking people. English and Norwegian.

It talks to the call server in `../server` for real calls. With no server it plays two scripted practice calls (pizza pickup, doctor's appointment).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no server set, every request runs as a scripted practice call. On a wide screen you get the pitch panel next to the phone. On a phone you get just the app.

Keys for the projector demo (ignored while typing):

| Key | Does |
| --- | --- |
| D | Play the scripted pizza demo, hands-free (never calls anyone) |
| R | Replay the intro |
| L | Switch English / Norwegian |

The language choice is saved in the browser (`spoken-lang`).

## Real calls

Point the app at the call server:

```bash
# terminal 1: the server, in mock mode (no keys, no real phone call)
cd ../server && CALL_PROVIDER=mock LLM_PROVIDER=mock bun run dev

# terminal 2: the app
NEXT_PUBLIC_API_URL=http://localhost:8787 npm run dev
```

| Setting | What it does |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Call server base URL, read at build time |
| `NEXT_PUBLIC_WS_URL` | Optional. Live socket base URL if it differs from the API (default: the API URL with `ws://`/`wss://`) |
| `?api=https://…` in the page URL | Use this server for this visit |
| `?api=off` | Scripted calls only |

Settings shows which mode is on. If the server can't be reached when you send a request, the app says so and runs a practice call instead.

With a server, a request goes: `POST /api/tasks`, then the server's questions appear as chat bubbles with tap-to-answer chips, then `POST /api/tasks/:id/answers` gives the plan card. "Start call" posts `/api/tasks/:id/call` and opens the live socket `/api/calls/:id/live`: transcript lines, approval requests (the sheet), notes and the result all come from there. Instructions, the two quick chips, approvals and hang-up go back over the same socket. See `CONTRACT.md`.

## How it is built

Next.js (App Router) and React, plain CSS, no UI library.

```
src/
  app/            layout (fonts, metadata), page, globals.css, icon
  components/     Intro, Pitch, Home (chat, demo, settings tabs), Call (transcript, approval sheet)
  lib/
    store.ts      all state and the timed flows (intro, chat, call), scripted and live
    server.ts     REST + live socket client for the call server
    scenarios.ts  the scripted calls
    i18n.ts       every string, EN and NO
    use-spoken.tsx  React hooks over the store
```

The store is a small class read through `useSyncExternalStore`. Each flow carries a run id, so starting a new flow (replay, new chat, hang up) cleanly stops the old one. Types for the server come from `shared/contract.ts` (path alias `@shared/*`, type imports only).

## Secrets

The app needs no key. API keys live on the server only. Local settings go in `.env.local`, which is git-ignored.
