# Spoken

**Du skriver, vi snakker.** You type what you need, and an AI makes the phone call for you. It says it's an AI, shows every word live, and asks you before it agrees to a price, a time or a booking. You can send it new instructions mid-call.

Built for Deaf and nonspeaking people. English and Norwegian.

This is the app UI with two scripted calls (pizza pickup, doctor's appointment). No real call is placed yet.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. On a wide screen you get the pitch panel next to the phone. On a phone you get just the app.

Keys for the projector demo (ignored while typing):

| Key | Does |
| --- | --- |
| D | Play the pizza demo, hands-free |
| R | Replay the intro |
| L | Switch English / Norwegian |

The language choice is saved in the browser (`spoken-lang`).

## How it is built

Next.js (App Router) and React, plain CSS, no UI library.

```
src/
  app/            layout (fonts, metadata), page, globals.css, icon
  components/     Intro, Pitch, Home (chat, demo, settings tabs), Call (transcript, approval sheet)
  lib/
    store.ts      all state and the timed flows (intro, chat, call)
    scenarios.ts  the scripted calls
    i18n.ts       every string, EN and NO
    use-spoken.tsx  React hooks over the store
```

The store is a small class read through `useSyncExternalStore`. Each flow carries a run id, so starting a new flow (replay, new chat, hang up) cleanly stops the old one.

## Plugging in real calls

A scenario talks to the call only through two functions (`CallIO` in `src/lib/scenarios.ts`):

- `say(who, text)` puts a line in the transcript, word by word
- `ask(config)` opens the approval sheet and resolves with your choice

To make real calls, replace the scripted `run()` with one that streams from a call server: call `say` for each transcribed line and `ask` whenever the AI needs your OK. The UI does not need to change.

## Secrets

Nothing here needs a key. When the call server is added, keep API keys in `.env.local` (already git-ignored) or on the server, never in the repo.
