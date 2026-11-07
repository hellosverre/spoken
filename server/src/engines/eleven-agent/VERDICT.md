# ElevenLabs Agents as Spoken's call engine: spike verdict

Status: **final for the spike.** One real call placed (conv_9401m6tpkff5fb1ad20jeg2z3fym, 42 s, +4746576760). Single call, n=2 measurable response turns: indicative, not statistics.

## What works (verified 2026-11-07)

| Piece | Result |
|---|---|
| Agent (Norwegian, `claude-haiku-5-5`, Flash v2.5, voice `nPczCjzI2devNBz1zQrb`, disclosure as `first_message`) | created, `agent_4201m6tp5qv0f46tywxw2y7cxc11` |
| Server tool `ask_user_approval` (webhook, 120 s timeout) via `https://spoken-api.hellosverre.com/eleven/tool/approval` | text chat: the model calls it before committing, the webhook blocked ~1.5 s until the harness answered JA, the model continued |
| Outbound over our Telnyx account | ElevenLabs SIP trunk → Telnyx FQDN connection `spoken-eleven` (new; credential auth; caller ID forced to +17733408724 with `ani_override: always`) |
| Live transcript without Enterprise | **does not work.** Polling `GET /conversations/:id` every 700 ms returned no turns during the call or at hangup; the transcript only appears after the call is processed. Only route to a live transcript: Enterprise monitoring, or bridge through our Call Control app (untested) |

## Constraints found

- **Number**: +17733408724 is already imported in another ElevenLabs workspace (one import per number), so it is registered here under a placeholder number; Telnyx rewrites the real caller ID. Bas's agent and number were not touched.
- **Telnyx plan cap**: 1 credential connection per account (already used), hence an FQDN connection.
- **No Telnyx media fork**: the call leg lives on ElevenLabs' SIP trunk, not on our Call Control app, so we cannot fork audio into our Scribe. The alternative (our Call Control app dials the callee and bridges to `sip.rtc.elevenlabs.io`) restores the fork but adds a hop and an inbound-trunk import; untested.
- **No hangup endpoint** for SIP calls: the user's "hang up" button can only wait for `max_duration_seconds` (150 s set) or the agent's `end_call`.
- **Safety is prompt-only**: no hook between the model and the TTS. Card/fnr/address gating, `ensureDisclosure`, spend limit and the approval-before-commitment rule live in our `safety.ts` today and cannot run here. The disclosure is deterministic (first message); the rest is model behaviour.
- **During approval** the model may keep talking ("Et øyeblikk…") but cannot be fed a hold sound/typing sound by us; no `note`/`level` events either.
- The old `simulate-conversation` endpoint was sunset 31 Oct 2026; use the text WebSocket (`agent-spike.ts sim`).

## Numbers (call 2026-11-07, platform metrics from `report`)

| Metric | ElevenLabs Agent | Our pipeline (Lim, ~1–2 s per brief, not re-measured here) |
|---|---|---|
| Callee stops → first agent audio | 0.92 s and 1.34 s (`convai_ttf_audio_since_silence`; LLM TTFB 0.32/0.52 s, TTS TTFB ~0.1 s, ASR 0.03–0.05 s) | ~1–2 s |
| First message | spoken at 0 s, TTS TTFB 0.10 s | cached, instant |
| Barge-in | callee said «Ja.» at 4 s over the disclosure; the platform flagged the greeting interrupted and answered next turn. Audible feel: judged by Sverre on the line, not measured here | choppy per Sverre |
| Approval wait | tool blocked 4.56 s (our 4 s auto-delay + 0.5 s overhead); agent said «Et øyeblikk, jeg sjekker det.» first, then confirmed on JA | «Et øyeblikk…» + typing sound |
| Norwegian | ASR handled hesitations («den, eh, den er…»), spoke times as «atten null null», prices correct | comparable Scribe v2 |
| Live transcript for the app | none until after the call | partials ~immediate |

## Verdict

**Don't switch.** Responses come ~0.3–0.7 s sooner than our 1–2 s and turn-taking is the platform's strength, but the app's core promise breaks: no live transcript (Deaf users read the call as it happens), no word confidence, no `level`, no hold/typing sounds, no hangup, and safety (card/fnr/address gates, spend limit) is prompt-only. Keep this as an optional engine for the demo call only if the live transcript is solved by bridging through Call Control; otherwise stay on our pipeline and tune its VAD/barge-in and TTS first-byte instead.
