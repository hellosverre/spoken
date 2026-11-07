# CONTRACT.md

Spoken: you type what you need done, and an AI makes the phone call for you (order a pizza, book the doctor, call anyone). Built for Deaf people, useful for everyone who'd rather not talk. Oslo Sprint 2026, created Sat 7 Nov after 09:00. All code is written fresh here: no copied repos or samples.

Product decisions: see `SPEC.md`. Shared types: `shared/contract.ts` (the source of truth; both sides import it).

## Layout

| Path | What | Owner |
|---|---|---|
| `shared/contract.ts` | Types for REST + WebSocket messages | Lead (change only via the lead) |
| `server/` | Bun + TypeScript call server on Hugin: REST, live WebSocket, Telnyx call control + media stream, ElevenLabs Scribe (STT) + TTS, LLM agent, safety rules | Lim |
| `web/` | Vite + React + TS web app (phone-first, Linear-like, dark + light, accessible) | Form |

## Runtime

- The server listens on `PORT` (default 8787). It's exposed publicly through a Cloudflare tunnel, with the hostname in `PUBLIC_URL`, for Telnyx webhooks and media streams.
- The web app calls the server at `VITE_API_URL` (REST) and `VITE_WS_URL` (live).
- Secrets come from env only, never committed:
  - `TELNYX_API_KEY`, `TELNYX_CONNECTION_ID`, `TELNYX_FROM_NUMBER`
  - `ELEVENLABS_API_KEY`
  - `LLM_PROVIDER` + `LLM_API_KEY`
  - `.env` uses `bas://` handles. Run through `bas-secret run`.
- With `LLM_PROVIDER=mock` and `CALL_PROVIDER=mock`, the whole flow runs with no keys: a scripted fake callee. The UI and the demo must work in mock mode.

## REST

| Method + path | Body → Response | Purpose |
|---|---|---|
| `POST /api/tasks` | `TaskInput` → `Clarify` | Read the task, return clarifying questions (always at least confirm the details) |
| `POST /api/tasks/:id/answers` | `{answers: Record<string,string>}` → `Plan` | Return the plan: who to call, number, what it will say, what it may share, what needs approval |
| `POST /api/tasks/:id/call` | `{approved: true}` → `{callId}` | Start the call (only after the user tapped OK) |
| `POST /api/calls/:id/hangup` | – → `{ok}` | User ends the call |
| `GET /api/calls/:id` | → `CallResult` | Result card + transcript after the call |
| `GET /api/voices` | → `Voice[]` | 3 ready voices + designed ones |
| `POST /api/voices/design` | `{description}` → `Voice` | ElevenLabs voice design |
| `GET/PUT /api/profile` | `Profile` | Name, address, allergies, preferences (no diagnoses, GDPR Art. 9) |

## Live WebSocket `GET /api/calls/:id/live`

Server → client `LiveEvent`, client → server `LiveCommand`. Exact shapes are in `shared/contract.ts`:

- `status` (dialing / ringing / connected / on_hold / ended)
- `transcript` (who: callee | agent, text, partial | final, confidence per word, so unsure words show grey)
- `agent_typing` (the AI is about to speak)
- `approval_request` (question + options; the AI waits, saying «Et øyeblikk…»)
- `note` (e.g. "refused to share card number")
- `result` (outcome + summary)

Client commands:
- `approval_response`
- `instruction` (a free-text message to the AI mid-call)
- `say_simpler`
- `tone` (friendly | firm | hurry)
- `hangup`

## Safety (enforced in the server, never only in the prompt)

- The first sentence always discloses the AI and the user's name: «Hei, jeg er en KI-assistent som ringer på vegne av {name}.» The callee may say no.
- Every commitment (pay, book, cancel, agree to a price or time) → `approval_request`. Default spend limit 0 kr.
- 110/112/113 and short codes are blocked → show the right emergency option instead.
- Never speak card numbers, CVV or PIN. Fødselsnummer only if the user approved it for this call, injected at the TTS step and never sent to the LLM. Address only with per-call approval.
- Refuse abusive goals. Max 20 calls/user/day. Max 10 min per call. Never impersonate the user.
- No audio recording. The transcript is sent to the client and not stored server-side after the call ends (keep in memory only).
