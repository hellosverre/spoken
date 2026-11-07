# Spoken: product context for AI agents

Read [AGENTS.md](AGENTS.md), [CONTRACT.md](CONTRACT.md) and [SPEC.md](SPEC.md) first. This overview connects the product intent to the repository; it does not replace those instructions. Based on source inspection on 7 November 2026, starting at upstream commit `c2062cd`. No live calls or end-to-end tests were performed for this document.

## What the app does and why

**Spoken lets someone conduct an outgoing phone call by typing.** The user writes what they want done; an AI calls the recipient, understands their speech, speaks on the user's behalf and displays the conversation as text. The user can send instructions and approve decisions during the call. The promise is **“Du skriver, vi snakker” / “You type, we talk.”**

The intended primary users are Deaf and nonspeaking people. People with phone anxiety or anyone who prefers typing may also find it useful. The problem is a task that still requires a phone conversation when the user cannot or does not want to speak. These are product intentions from SPEC/README, not proof of demand or completed target-user research.

Example task: “Order a large pepperoni for pickup at six.” Spoken checks details, presents a plan, calls the restaurant and asks the user to approve an offered price or time. A different time must remain a proposal until approved. This is an illustrative scenario, not a claim that a particular restaurant or booking integration exists.

There are three participants:

- **User:** the person typing in the web app and authorising the task.
- **Callee:** the person answering an ordinary telephone call; they do not need the web app.
- **Call agent:** the software speaking on the user's behalf. It must identify itself as AI rather than impersonate the user.

An **AI coding agent** reading this file maintains the product; it is distinct from the call agent running inside Spoken.

## Intended user journey

1. Enter a task or choose a preset. A profile/contact may supply details, but missing information must be clarified.
2. Review what Spoken understood and answer clarification questions.
3. Review a plan: recipient and phone number, goal, information to share, opening disclosure and decisions requiring approval. Explicitly approve starting the call.
4. Follow status and live text. Send instructions such as “ask about gluten-free options”, change tone, ask for simpler language or hang up.
5. Respond to approval requests when the recipient proposes a commitment. Waiting and hold behaviour give the user time to type.
6. Read the result and transcript. Result types distinguish `done`, `partial`, `failed`, `refused` and `no_answer`; an interrupted or unconfirmed call must not be described as a completed booking.

The UI supports English/Norwegian; the current phone pipeline is oriented toward Norwegian. Language selection is not evidence that arbitrary spoken languages work. Web-first, phone-oriented presentation and understandable text/approval controls are central to the accessibility intent. Screen-reader suitability and other accessibility claims require testing.

## How the system works

| Component | Responsibility | Starting points |
|---|---|---|
| Next.js + React web app | Task entry, plan, transcript, approvals, profile and contacts | [web/src/components/SpokenApp.tsx](web/src/components/SpokenApp.tsx), [web/src/lib/store.ts](web/src/lib/store.ts) |
| UI/server bridge | REST requests and live WebSocket events | [web/src/lib/real-call.ts](web/src/lib/real-call.ts) |
| Bun + TypeScript server | Task planning, call startup, HTTP/WebSocket routes and persistence integration | [server/src/app.ts](server/src/app.ts), [server/src/index.ts](server/src/index.ts) |
| Call session | Conversation loop, approvals, user commands, turn-taking and results | [server/src/call/session.ts](server/src/call/session.ts) |
| Telephone connection | Telnyx call control and phone audio/media stream | [server/src/call/telnyx-line.ts](server/src/call/telnyx-line.ts) |
| Speech and reasoning | ElevenLabs Scribe realtime transcription plus batch checks, LLM replies, ElevenLabs streaming speech synthesis | [server/src/voice](server/src/voice), [server/src/llm](server/src/llm) |
| Shared protocol | Task, plan, event, command, result and profile types | [shared/contract.ts](shared/contract.ts) |
| Persistence | Profiles, contacts and call summaries through server-side Supabase access, with memory fallback | [server/src/db.ts](server/src/db.ts), [server/db/schema.sql](server/db/schema.sql) |

In a real call, incoming phone audio becomes text through Scribe, the LLM chooses a response/action, session and safety logic mediate it, and TTS sends speech back through the phone line. Status, transcript and approval events travel to the user over WebSocket. Text typed by the user returns as commands.

Phone audio, ambiguous Norwegian numbers, background speech and interruptions are known engineering difficulties. Batch transcription is a second opinion, not a guarantee of correctness. See [HANDOFF.md](HANDOFF.md) for observed problems and current tuning work; do not copy its historical observations into claims of present reliability.

## Three execution modes to distinguish

- **Frontend-only scripted demo:** with no `NEXT_PUBLIC_SPOKEN_API`, the web app uses built-in scenarios. This shows interaction design without testing the backend or dialling a number.
- **Backend mock flow:** `CALL_PROVIDER=mock LLM_PROVIDER=mock` uses a scripted callee/agent through the server. It exercises integration without real phone calls or provider keys.
- **Real telephone flow:** requires Telnyx configuration, speech/LLM credentials, an allowed destination and the required demo passcode. In `app.ts`, a missing/wrong passcode on a Telnyx-configured server selects a mock call. A visible call screen alone does not prove real telephony.

Use [README.md](README.md) and [server/README.md](server/README.md) for local commands and [server/src/config.ts](server/src/config.ts) for actual environment variables/defaults. The current Next.js bridge uses `NEXT_PUBLIC_SPOKEN_API`; CONTRACT's `VITE_API_URL`/`VITE_WS_URL` wording is older. SPEC's Vite/Node stack description is also older than the inspected Next.js/Bun implementation.

## Safety, privacy and authority

- The product requires AI disclosure, user approval before commitments, emergency/short-number blocking and refusal of abusive goals. Limits and real-number allowlisting constrain calls. Inspect [server/src/safety.ts](server/src/safety.ts), `app.ts` and `session.ts` before changing these behaviours.
- Safety code includes pattern-based checks and outgoing sensitive-data filtering. Their existence is not proof that every wording or attack is handled. Preserve tests and verify affected cases.
- Profiles, contacts and summaries have database tables; there are no transcript/audio columns in that schema. Summaries and profile fields can still contain personal information.
- **Database policy is not the whole retention policy.** `session.ts` enables JSONL call logs unless `CALL_LOG=0`; `telnyx-line.ts` can save audio when `SAVE_CALL_AUDIO=1`. HANDOFF reports debug audio enabled, whereas CONTRACT says no recording. Verify current runtime settings, files, access and deletion before making privacy claims. Do not publish real call data as examples.
- The demo uses a device UUID for persistence association and a passcode gate for real calls. Do not describe this as reviewed production authentication or legal consent.
- Provider handling, sensitive data, authority to enter agreements and retention remain questions for review. SPEC still has open legal questions; this overview makes no legal-compliance claim.

## Scope, business and evidence

SPEC places native apps later and lists voice cloning/multiple parallel calls as stretch goals. Its free-minutes/pay-per-minute idea and possible future NAV route are plans, not validated pricing, approved reimbursement or partnerships. Do not promise arbitrary automated calls, inbound callbacks or emergency use from these plans.

When preparing product or jury explanations, answer what is known and mark what is missing:

| Area | What the team needs to explain |
|---|---|
| Founders | Next milestone if the team wins, owner, resources and success measure |
| IT/security | Biggest measured technical risk and actual failure/recovery behaviour |
| Product | Core flow, deliberate cuts and why they protect usefulness |
| Marketing | Proposed route to the first 100 users, with untested assumptions explicit |
| Design | Actual user-test observations and resulting changes; distinguish teammate tests |
| Law | Unresolved data, consent, retention and agreement questions |
| Domain | A real everyday workflow and comparison with alternatives users already use |

No user counts, target-user test findings, legal clearance or partnerships are established by this overview. Collect evidence rather than inventing answers.

## How a new coding agent should proceed

- Read the current instructions and the specific component's documentation before editing. Respect folder ownership; shared protocol changes require the lead.
- Use SPEC for intended decisions, shared types and code for implemented interfaces, and HANDOFF for operational context. Surface conflicts instead of silently treating all documents as consistent.
- Keep the mock flow working. Server validation commands are in [server/package.json](server/package.json); web commands are in [web/package.json](web/package.json). Report which checks actually ran.
- Keep secrets out of files/commits/output. Do not trigger real calls, paid generation, deployment or shared-server restarts merely to understand the app.
- Update relevant documentation when behaviour changes. State separately: implemented in code, verified in tests, observed in a real call, planned, or unknown.
