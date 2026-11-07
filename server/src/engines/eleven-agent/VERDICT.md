# ElevenLabs Agents as Spoken's call engine: spike verdict

Status: **provisional.** Built and wired, text path verified end to end; the live phone call (latency, barge-in feel) is waiting for the lead's go. Fill the table from `report` output, then settle the verdict.

## What works (verified 2026-11-07)

| Piece | Result |
|---|---|
| Agent (Norwegian, `claude-haiku-5-5`, Flash v2.5, voice `nPczCjzI2devNBz1zQrb`, disclosure as `first_message`) | created, `agent_4201m6tp5qv0f46tywxw2y7cxc11` |
| Server tool `ask_user_approval` (webhook, 120 s timeout) via `https://spoken-api.hellosverre.com/eleven/tool/approval` | text chat: the model calls it before committing, the webhook blocked ~1.5 s until the harness answered JA, the model continued |
| Outbound over our Telnyx account | ElevenLabs SIP trunk → Telnyx FQDN connection `spoken-eleven` (new; credential auth; caller ID forced to +17733408724 with `ani_override: always`) |
| Live transcript without Enterprise | polling `GET /conversations/:id` every 700 ms, whole turns only, no words/confidence, no partials |

## Constraints found

- **Number**: +17733408724 is already imported in another ElevenLabs workspace (one import per number), so it is registered here under a placeholder number; Telnyx rewrites the real caller ID. Bas's agent and number were not touched.
- **Telnyx plan cap**: 1 credential connection per account (already used), hence an FQDN connection.
- **No Telnyx media fork**: the call leg lives on ElevenLabs' SIP trunk, not on our Call Control app, so we cannot fork audio into our Scribe. The alternative (our Call Control app dials the callee and bridges to `sip.rtc.elevenlabs.io`) restores the fork but adds a hop and an inbound-trunk import; untested.
- **No hangup endpoint** for SIP calls: the user's "hang up" button can only wait for `max_duration_seconds` (150 s set) or the agent's `end_call`.
- **Safety is prompt-only**: no hook between the model and the TTS. Card/fnr/address gating, `ensureDisclosure`, spend limit and the approval-before-commitment rule live in our `safety.ts` today and cannot run here. The disclosure is deterministic (first message); the rest is model behaviour.
- **During approval** the model may keep talking ("Et øyeblikk…") but cannot be fed a hold sound/typing sound by us; no `note`/`level` events either.
- The old `simulate-conversation` endpoint was sunset 31 Oct 2026; use the text WebSocket (`agent-spike.ts sim`).

## Numbers (fill after the call: `bun scripts/agent-spike.ts report <conversation_id>`)

| Metric | ElevenLabs Agent | Our pipeline (Lim, ~1–2 s per brief) |
|---|---|---|
| Callee stops → agent audio (median) | _pending_ | _pending_ |
| Barge-in: agent stops talking | _pending_ | choppy per Sverre |
| Live transcript lag in the app | ~0.7 s poll + turn finalisation | partials ~immediate |

## Verdict (provisional)

**Don't switch wholesale; keep it as an optional engine behind the same interface.** Turn-taking is the one thing ElevenLabs owns and we do not, so if the call shows a clear latency/barge-in win, use it for the demo call only. Everything the contract promises beyond that (word confidence, `level`, hold sounds, safety gates in code, user hangup) is lost or weaker. Revisit once the call numbers are in.
