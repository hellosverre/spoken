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

## Call #3 (Sat 7 Nov, real LLM: OpenRouter `anthropic/claude-haiku-5.5`, Sverre playing the shop)

Connected 8.9 s; 7 agent turns, 80 s; agent ended politely when the "shop" said it had to talk to someone. No price was offered, so no approval card. One barge-in, TTS stopped correctly. LLM cost: $0.00084 for the call turns + ~$0.0004 clarify/plan/summary.

| Per turn (median of 7) | ms |
|---|---|
| STT (callee stops → Scribe commit, incl. 0.5 s VAD window) | ~900 |
| LLM first token (Haiku 5.5 via OpenRouter) | ~620 (430–910) |
| TTS first byte (Flash v2.5, warm) | ~165 |
| **Total: callee stops → agent audio** | **~1.65 s** (1.5–2.3 s) |

STT heard: «Der går det bra», «Okay», «Med røret ett», «Så har vi gruppe A», «Sa du klokka ett?», «Nei, bare sjekke», «Jeg må snakke med rektor». Short utterances get misheard; compare with what Sverre actually said.

## LLM bench (OpenRouter, 3 Norwegian call turns × 3 runs, `bun scripts/llm-bench.ts`)

| Model | TTFT | 1st sentence | Checks | Note |
|---|---|---|---|---|
| mistralai/mistral-small-2603 | 374 ms | 440 ms | ok after prompt fix | fastest; approval cards vague («Er det greit for deg?») |
| **anthropic/claude-haiku-5.5 (default)** | 600 ms | 720 ms | all ok | best approval cards (item + price + time), cheapest ($0.10/$0.50 per M) |
| google/gemini-3.1-flash-lite | 625 ms | 699 ms | all ok | «klokken», a bit stiff |
| meta-llama/llama-4-maverick | 464 ms | 674 ms | 3 issues | dropped the time |
| openai/gpt-4.1-mini | 724 ms | 880 ms | all ok | asks [[ASK]] too early |

## Call #4 (Sat 7 Nov, merged main, Haiku 5.5, Sverre as the shop)

88 s, outcome `done` («Bestilt: 1 stor pepperoni, hentes 18:00 på navnet Sverre»). Approval card fired at 37 s (auto-JA by the test script). Cost: Telnyx $0.0814 (120 s billed), LLM $0.00134 (9 req), TTS 597 chars, STT 87 s realtime + 11 batch segments.

Latency regressed: median total ~2.37 s (STT ~650, LLM ~610, TTS ~150) because realtime marks unsure words on almost every real-line segment, so the confidence gate waited 0.6–1.0 s for batch on nearly every turn. Batch fixed real errors («passordet … dronning» → «personen … pepperoni», «Vil gi pizzabestilling» → «Hvilken pizza vil du ha?») but realtime marked none of those words unsure. Misaligned windows produced wrong revisions («I Storo.» → «Bestill levering»); revisions now need word overlap.

## Approval timeout → hold (Sverre, Sat 7 Nov)

User hasn't answered an approval card after `HOLD_ASK_SEC` (30): agent asks «Beklager ventetiden. Jeg får ikke helt kontakt med {name} akkurat nå. Har du mulighet til å vente litt?».
Yes (or no answer in 10 s) → «Tusen takk!» + soft generated hold music (Am–F–C–G sine pads, ~20 dB under speech), «Takk for at du venter, jeg er straks tilbake.» every `HOLD_REMIND_SEC` (20).
No, or `HOLD_MAX_SEC` (120) since the card → callback line, call ends `partial`. User answers any time → music off, «Takk for at du ventet!», call continues.
Notes for the web app (agreed with Form): «Venter på svaret ditt – spør om personen kan vente.», «Personen venter… N s (ventemusikk på)», «Personen venter… N s», «Ventemusikk av – du svarte, samtalen fortsetter.», «Personen kunne ikke vente – tilbød å ringe tilbake senere.» Tests: `test/hold.test.ts`.

## STT accuracy (Sat 7 Nov)

- Scribe input is 16-bit PCM decoded once from Telnyx G.711 (`STT_INPUT=pcm_8000`, `ulaw_8000` for A/B).
- 40-term call lexicon + task names as keyterms (`CALL_LEXICON` in `app.ts`).
- Word confidences < 0.6 reach the LLM as «⟨usikre ord: …⟩»; the prompt says reinterpret from context or ask one short question.
- Batch Scribe v2 re-transcribes every finished segment (voice onset → offset, ~0.6 s) and replaces the live text when it differs and looks like the same utterance. The turn waits for it (max `REVISION_WAIT_MS`=1000) only when realtime had unsure words. `STT_BATCH=0` turns it off.

WER on 10 Norwegian shop sentences, TTS'd, band-limited to 8 kHz + A-law (`bun scripts/stt-wer.ts`):

| Variant | WER |
|---|---|
| A: A-law→µ-law, ulaw_8000 (call #3 path) | 2.7 % |
| B: A-law→PCM16, pcm_8000 | 5.3 % |
| C: B + lexicon | 5.3 % |
| **D: Scribe v2 batch on the segment + lexicon** | **1.3 %** |

On clean synthetic audio all realtime variants are within noise (errors are «Ett/Et», «åttini» spelling). The codec was not the cause of «rektor». In the replay, batch fixed «110 kroner» → «hundre og åttini kroner». Real-voice WER needs a dev call with `SAVE_CALL_AUDIO=1` (callee audio to `.cache/calls/`, gitignored; delete after).

## Latency work (replay, `bun scripts/replay.ts`)

| | callee audio ends → agent audio (median) |
|---|---|
| Before (0.5 s VAD, sentence TTS, no backchannel) | 1787 ms |
| After (0.3 s VAD + unfinished hold, first-clause TTS, cached «Ja,»/«Mm,» at 450 ms, speculative LLM, warm LLM) | ~1030 ms first audio; ~1280–1450 ms first content |

## Debug log

Every call writes `server/logs/<callId>.jsonl` (gitignored): all live events, each agent turn (`turn_start`/`turn_end` with what was said), fillers, escalations, skipped duplicates, barge-in, Telnyx webhooks, media format, TTS first byte and commit→audio latency. `CALL_LOG=0` turns it off; **turn it off for the public demo** (CONTRACT: no transcript stored server-side).

```bash
jq -r 'select(.kind=="event" and .ev.type=="transcript") | "\(.ev.who): \(.ev.text)"' server/logs/<callId>.jsonl
```

## Anti-loop rules (session, any LLM)

- Never say a sentence that was said in the last 3 agent turns.
- "Didn't get that" lines count over the last 4 turns: 1st as is, 2nd → rephrase the errand as a yes/no question, 3rd → «Beklager, jeg hører deg dessverre ikke godt nok. {name} tar kontakt på en annen måte. Ha det bra!» and end (`failed`).
- Filler («Mm, et øyeblikk.» etc., rotated) only when no sentence is ready after 1.5 s. The approval wait still says «Et øyeblikk…».

## Call #2 (Sat 7 Nov, pizza goal, mock LLM)

| | Result |
|---|---|
| Connect | ringing 0.7 s, connected 7.6 s |
| STT | Works after the PCMA fix: "Det går bra." ×3, "Det var det." (callee's real words not logged by us; Sverre to confirm) |
| Latency, Scribe commit → agent audio | 250 ms first turn (cold TTS), then 75–93 ms (cached TTS); plus the 0.5 s VAD silence window → ~0.6–0.75 s from callee stops to agent speaks. A real LLM will add its time-to-first-sentence |
| Barge-in | Not triggered in this call (now logged as `[barge-in]`) |
| End | Callee hung up (`normal_clearing`, source=callee) after the mock agent looped on "kan du si det en gang til?" |
| Fix | Mock agent treats any non-refusal after the opening as "go ahead" and asks to repeat at most once |

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
