# Spoken call server

Bun + TypeScript. REST + live WebSocket per `../CONTRACT.md`, types from `../shared/contract.ts`.
No runtime dependencies (Bun's own HTTP/WebSocket/fetch).

## Run

```bash
bun install
```

Mock mode, no keys (scripted Norwegian Domino's call with one JA/NEI approval):

```bash
CALL_PROVIDER=mock LLM_PROVIDER=mock bun src/index.ts
```

Tests (full mock flow over REST + WS, safety rules, barge-in, segmenter):

```bash
bun test
```

Real calls (`server/.env` uses `bas://` handles, copied from `.env.example`):

```bash
BAS_SECRET_TOKEN=… /home/sverre/Projects/bas/ops/bas-secret run -- env CALL_PROVIDER=telnyx CALL_ALLOWLIST=+47XXXXXXXX bun src/index.ts
```

```bash
bun scripts/testcall.ts +47XXXXXXXX "Ring og si hei, og spør hvordan det går"
```

Offline TTS → Scribe check, no phone call (about 200 TTS chars the first time, cached after that):

```bash
BAS_SECRET_TOKEN=… /home/sverre/Projects/bas/ops/bas-secret run -- bun scripts/loopback.ts
```

## Pipeline

```
Telnyx Call Control (dial, stream_bidirectional_mode=rtp, PCMU)
  ⇅ wss /telnyx/media?call=…&t=<per-call token>
callee µ-law ─┬─ local energy VAD (100 ms) ─┐
              └─ Scribe v2 Realtime (no, ulaw_8000, VAD commit 0.5 s) → partial/final transcript
                                                                      ↓
                    barge-in: stop TTS + "clear" ◄── CallSession ──► LLM (stream) → sentence segmenter
                                                        │                 ↓ safety gate (card/fnr/commitment)
                                                        └─ ElevenLabs TTS (ulaw_8000) → paced 20 ms frames
```

- `src/call/session.ts`: the call brain. Same code for mock and Telnyx (`CallLine` interface).
- `src/call/telnyx-line.ts`: dial, webhooks (`POST /telnyx/webhook`), media socket, paced playback, typing sound.
- `src/call/mock-line.ts`: scripted callee. `MOCK_SPEED` scales timing (tests use 0.02).
- `src/llm/`: `LlmProvider` interface. `mock` (rule-based, also holds a basic real call), `mistral` / `openai` (chat-completions JSON + SSE). Any LLM failure falls back to mock.
- `src/safety.ts`: all safety rules, in code.

## Safety rules in code

| Rule | Where |
|---|---|
| Disclosure first: «Hei, jeg er en KI-assistent som ringer på vegne av {name}.» + "du kan si nei" | `ensureDisclosure`, spoken by the session before the LLM is ever asked |
| 110/112/113/1412/116xxx and short codes blocked, with the emergency alternative | `checkNumber`; checked at plan time and again at call time |
| Real calls only to `CALL_ALLOWLIST` | `startCall` |
| Commitment without the user's JA → stopped, becomes `approval_request` + «Et øyeblikk…» + typing sound | `isCommitment` gate in `runTurn` |
| Callee asks for card/CVV/PIN → fixed refusal, the LLM isn't asked; card-like digit runs never reach TTS | `detectSecretAsk`, `filterOutgoing` |
| Fødselsnummer: `{{FNR}}` placeholder, filled only at the TTS step if the plan shares `fnr` and the call request carried it; never in LLM context or transcript | `filterOutgoing` |
| Address: only with per-call approval (plan `willShare` or a mid-call JA) | session + `filterOutgoing` |
| Abusive goals / impersonation refused | `checkGoal` |
| 20 calls/user/day, 10 min per call (server timer + Telnyx `time_limit_secs`) | `takeCallSlot`, `maxTimer` |
| No recording; transcript in memory only, dropped 30 min after the call | `store.ts` |

## API notes for web/

- `POST /api/tasks` on a blocked goal/number returns `questions: []`; the plan from `/answers` then has `blocked`.
- `POST /api/tasks/:id/call` → 400 without `{approved:true}`, 403 if blocked/not allowlisted, 429 over the daily limit.
- `GET /api/calls/:id` → 202 `{status, inProgress}` while the call runs, `CallResult` after.
- Live WS replays all past events on connect, so a late join sees the whole call.
- Callee `transcript` events are emitted again with the same `id` once word confidences arrive (replace by id).

## Call #1 (Sat 7 Nov, to the team's test number)

Connected in 8.5 s; disclosure played from cache instantly (TTS first byte 0 ms). Then silence: Telnyx delivered the callee track as **PCMA (A-law)**, Scribe got it labelled µ-law and returned nothing, so the agent never got a turn; the callee hung up after 35 s (`normal_clearing`). Fixed: A-law → µ-law transcode from `media_format`, plus a silence check ("Hallo, hører du meg?" after 8 s, hang up after a second miss).

## Measured (Sat 7 Nov, Hugin → ElevenLabs, offline loopback)

| Step | Result |
|---|---|
| TTS first byte, Flash v2.5, warm connection | ~150 ms (cold first request ~850 ms; prefetch during ringing warms it) |
| TTS v4 vs Flash, same 110-char line | v4: 3.1 s total; Flash: 0.4 s total. **Flash is the default** (`TTS_MODEL`) |
| Scribe: speech end → committed transcript | 0.71–0.81 s (0.5 s of that is the VAD silence window, `SCRIBE_SILENCE_SECS`) |
| Scribe Norwegian accuracy on TTS audio | Near perfect; "KI-assistent" exact once boosted as a keyterm (before: "kundeserviceassistent") |
| Word logprobs | −0.4…−1.3 even on correct words; mapped linearly (`1 + lp/2.5`), so only real misses go grey |

The server logs `[latency] callee commit → agent audio: N ms` per turn and `tts first byte` per sentence on real calls.

## Voice (after call #1: "too fast, too bright")

Default **Brian** (`nPczCjzI2devNBz1zQrb`), Flash v2.5, `TTS_SPEED=0.88`, `TTS_STABILITY=0.7`. Offline A/B on the disclosure (`bun scripts/voices.ts`, WAVs in `.cache/voices/`):

| Voice | Median pitch | Pace | Scribe heard |
|---|---|---|---|
| **Brian (default)** | 94 Hz | 14.4 chars/s | exact |
| George | 129 Hz | 15.4 chars/s | exact |
| Bill | 140 Hz | 13.3 chars/s | "den KI-assistent" |

## Accounts

- Telnyx Call Control app **spoken** (`3087791926577989207`), webhook `https://spoken-api.hellosverre.com/telnyx/webhook`, on the Default outbound profile (US/CA/NO). From number +17733408724.
- ElevenLabs key is on the **free** tier (10k chars/month). Fixed lines (disclosure, «Et øyeblikk…», card refusal, short phrases) are cached in `.cache/tts`.
- Emergency text names no SMS number (unverified); it says "ring 113/112/110, eller bruk nødmeldingstjenesten".
