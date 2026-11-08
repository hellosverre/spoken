# Handoff: state of the phone agent (7 Nov 2026)

For the next agent picking this up. Read AGENTS.md → CONTRACT.md → SPEC.md first.

## Where things are
- Live: https://spoken-api.hellosverre.com/ (phone UI; `?passcode=…` link from the owner, demo login demo/demo).
- Server runs on `hugin` in `/home/sverre/Projects/spoken/server` via `ops/run-server.sh` (a loop: restarts 2 s after the process exits). Secrets come from `server/.env` handles through `bas-secret`; never print or commit them.
- Pipeline: Telnyx (8 kHz G.711) → ElevenLabs Scribe v2 realtime (`language_code=no`) + a batch Scribe second opinion per segment → LLM (`openrouter:anthropic/claude-haiku-5.5`) → `eleven_flash_v2_5` TTS.
- Tests: `cd server && CALL_LOG=0 bun test` (mock mode must keep passing).

## Deploy
- **Server:** on hugin, `git status` first. Another agent session also works in that checkout, so never overwrite its uncommitted work. Then `git merge origin/main`. Check no call is live: a fresh `server/logs/c_*.jsonl` with telnyx events. Then `kill $(pgrep -f "^bun src/index.ts$")`, and the loop restarts it.
- **Web:** `cd web && rm -rf .next && SPOKEN_EXPORT=1 NEXT_PUBLIC_SPOKEN_API=/ npx next build` (plain `npm run build` makes no `out/`), then `rsync -a --delete out/ hugin:/home/sverre/Projects/spoken/web/out/`. No restart needed.

## Debug data from real calls
- `server/logs/<callId>.jsonl`: every event (transcripts, `stt_batch` with `rtConf`/`batchConf`, latency, turns).
- Production runs with `SAVE_CALL_AUDIO=0` and `CALL_LOG=0`: no audio or transcripts are written. For local debugging only, `SAVE_CALL_AUDIO=1` writes `server/.cache/calls/<callId>.pcm` + `.segments.jsonl` (gitignored); delete after use.
- `bun scripts/stt-segments.ts <callId>` (under bas-secret) re-runs batch STT on a saved call, for tuning.

## Done recently
- **Opening** (`session.ts` `sayOpening`/`waitForGreeting`, `test/opening.test.ts`):
  - On a phone line we wait for the answerer's greeting («Domino's, det er Vil») plus a 600 ms gap. The gap is doubled if the greeting sounds unfinished. If nobody speaks, we start after 3 s.
  - The KI disclosure can't be interrupted. Anything said over it is answered right after.
  - If the line is silent 2 s after the disclosure, the agent states the errand.
  - Env knobs: `GREETING_WAIT_MS`, `GREETING_GAP_MS`, `GREETING_MAX_MS`, `AFTER_OPENING_MS`.
- **Numbers** (`numbers.ts`): Norwegian -ten/-ti numbers sound alike on the phone (femten/femti). An unsure one reaches the LLM as `⟨uklart tall: 15 eller 50⟩`, and the LLM asks back.
- **Made-up lines** (`batch-verdict.ts`, call c_05079f8d4529):
  - If batch STT tags a segment as `[snakking i bakgrunnen]`/`(musikk)`, the line is dropped from the transcript and the history, and is not answered.
  - If batch is ≥ 0.85 sure and realtime < 0.65, batch wins (env `BATCH_SURE`, `RT_UNSURE`). Otherwise batch may only fix numbers.
  - The phone UI holds callee lines 1.2 s for that correction (`web/src/lib/real-call.ts`).
- **Background voices** (`loudness.ts`; calls c_d3457ddfdd92, c_73b6b5529e9b): the line learns the callee's level (median p90 RMS of the last 5 kept lines). Under 30 % of it: the line reaches the LLM marked `⟨svak stemme⟩` (it answers if it fits, else `[[SKIP]]`) and can't barge in. Under 10 %: dropped (`background_speech`). Loudness alone can't separate them: the callee once spoke at 604 while a background voice was 751. Env `BG_RATIO`, `BG_DROP_RATIO`, `BG_MIN_LEVEL`.
- **Made-up times** (c_73b6b5529e9b): the LLM copied the prompt's example order «stor pepperoni … halv sju». Examples are now `[hva]/[når]` forms. A blocked time at the end of a sentence is cut out and the rest is said (`withoutTimes`), so the agent no longer goes silent.
- **Prompt** (`llm/prompt.ts`): all details in the first errand sentence, one question at a time, implicit confirmation of prices and times, a read-back before ending an order, a plain Norwegian goodbye.

## Next, in priority order
1. **Tune STT on saved audio.** Replay `.cache/calls/*.pcm` and compare realtime vs batch confidences across several calls, then adjust `BATCH_SURE`/`RT_UNSURE`. Batch windows are sometimes misaligned: c_8 batch included «Flott!» from before and «Ingrid» from the next segment. Check `secondOpinion` window margins (onset −250 ms, voice end +250 ms).
2. **Turn detection.** Silence alone is a weak cue. Options:
   - Scribe has `commit_strategy=turn_prediction`.
   - Pipecat Smart Turn v3 supports Norwegian. LiveKit's turn detector does not.
   - Wait longer after a number or an unfinished clause. Vapi waits about 0.5 s after numbers.
3. **Barge-in.** Only stop for ≥ 2 real words or 300–400 ms of speech, and resume after a false interruption. Laughs and «mm» should not cut us off.
4. **Voicemail.** Use Telnyx answering machine detection (`answering_machine_detection` on dial), so the agent doesn't talk to a voicemail greeting.
5. **Keyterms.** Pass the shop name, menu items and the user's name as Scribe keyterms. «Frode»/«Froks» was probably «hvilket navn».

## Research notes (phone-call conversation)
- **Opening:** Norwegian business answers are «[Firma], det er [navn]» / «[Firma], hei». The caller speaks after the answerer's first turn ends, and a canonical opening is summons → answer → identification → greeting → reason. Schegloff, *Sequencing in conversational openings* (1968).
- **Gaps:** the gap between turns is ~200 ms across languages, so a long silence carries meaning. Stivers et al. 2009, https://pmc.ncbi.nlm.nih.gov/articles/PMC2705608/. Heldner & Edlund 2010, *Pauses, gaps and overlaps in conversations*.
- **Turn-taking:** Vapi start-speaking plan, https://docs.vapi.ai/customization/speech-configuration. Deepgram end-of-turn docs.
- **Telnyx AMD:** https://developers.telnyx.com/docs/voice/programmable-voice/answering-machine-detection
- **Numbers:** Norwegian number words confuse STT (femten/femti, sytten/sytti), per a Telenor study. Read prices and times back. «halv sju» = 18:30.

## Saving tokens
- Read `server/logs/<id>.jsonl` with `grep`/`python3 -c` filters, not whole files. The `.segments.jsonl` file is the quickest view of what was heard.
- `bun test test/<file>.test.ts` runs one file.
