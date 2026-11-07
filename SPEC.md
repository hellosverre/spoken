# SPEC.md: Spoken

Decisions from Sverre's 100-question page, 2026-11-06 20:42. Product decisions. This repo was created Sat 7 Nov 09:02.

## What it is

- An AI agent that makes phone calls for you from what you type: order a pizza, book a doctor, call anyone.
- **Story:** started from a friend with phone anxiety. **Deaf people are a main point.** "Built for Deaf people, useful for everyone."
- **Name:** Spoken for now (picked 2026-11-06 21:12). **Discuss again Sat:** Spoken AAC (spokenaac.com, 300k users, US trademark, same audience) owns the name. Alternatives: Kall, Courier, Say. Free domains: getspoken.no, usespoken.no.
- **Promise:** «Du skriver, vi snakker.»
- **Language:** the product and pitch are mainly English, with a Norwegian version. The call itself is in the callee's language (Norwegian in Norway).

## Flow

1. One big box: "What do you want done?" Plus premade and custom shortcuts, and saved places with import from contacts.
2. The AI **always asks clarifying questions** first, then shows **the plan**. You tap OK.
3. Number: you type it, or the AI looks it up (both).
4. The AI does the whole call. During it you see live text and a summary. You can **send instructions to the AI mid-call** (not a full takeover).
5. After: a result card + the full transcript.

## Safety

- **Always asks before committing** (pay, book, cancel). Default spend is 0 kr. A user-set "just do it" limit is allowed, with safeguards (hard cap, read-back).
- Discloses AI in the first sentence: «Hei, jeg er en KI-assistent som ringer for Sverre». Tells the callee they can say no.
- 110/112/113 are blocked, and the right emergency option is shown instead.
- Refuses abusive goals. Max 20 calls per user per day. Never impersonates: always "på vegne av".
- **Personal data (fnr, card):** rule TBD from the legal research tonight.
- When unsure it asks you and keeps the line open. "Can I talk to the person?" → explain, offer live typing.
- Text only, no audio recording. Transcript on the phone only. Short privacy note, plus a list of the data processors.
- Under-18 users: skip, mention in the pitch. Scam warning: later.

## AI and voice

- **Model:** test 3 on Sat morning, pick the fastest good one. Personality and voice are **customisable**. Tone buttons (friendly / firm / hurry).
- **Barge-in:** the AI stops the moment the other side talks, like ChatGPT voice. Needs VAD + cancelling TTS in our pipeline.
- While waiting for the user: «Et øyeblikk…» + a typing sound. "Say it simpler" button. Profile memory (name, address, allergies). No learning from past calls yet.
- **STT:** ElevenLabs Scribe realtime, keyterm boost from the task text, unsure words greyed out, ask to repeat on a bad line.
- **TTS:** A/B ElevenLabs v4 vs Flash Sat morning. A bit slow and clear. Under 1 s response.
- **Voices:** 3 ready-made + design your own. Cloning is a stretch.
- Stretch goals: phone menus (DTMF) + hold music; **call 3 places, pick the best** (big wow).

## Phone

- Telnyx (existing account; confirm it's the best fit). Outgoing only. Max 10 min. Weekend budget 100 kr.
- Caller ID: try the verified own number Sat (603 Decline seen Fri when calling himself), else the Telnyx number. A +47 number only after a price check.
- Our own pipeline: Telnyx media stream ↔ server ↔ Scribe / LLM / ElevenLabs TTS.
- Test calls: teammates first, then one juror.

## App

- Web app first (animations matter). Native later.
- Linear-like look. Dark + light. Full accessibility (big text, contrast, screen reader). Vibration + flash alerts.
- 3-step onboarding ending with the voice pick. No login for the demo. Approval = big JA / NEI.

## Pitch

- Jury questions and evidence checklist: [PITCH.md](PITCH.md). 2-minute script (Norwegian): [PITCH-SCRIPT.md](PITCH-SCRIPT.md).
- Opening: «Nå ringer jeg en av dere, og jeg sier ikke et ord.» Live call to a juror + a recorded backup.
- Order the team's Domino's (Sat 18:00) with the app: **ask Domino's first**.
- Show live typing briefly, a safety moment ("it refused"), and the "Built with ElevenLabs" panel.
- Two people pitch. Prepare the 5–10 min final version Sat night.
- Use Ingvild's words only with her written OK. Market numbers from research tonight.
- Money: free minutes, then pay per minute. NAV hjelpemiddel later. One line on businesses. Norway first. Continue if it goes well.

## Build

- The call system is built by Bas's AI devs; a teammate reviews. UI by Form. Klikk tests after each merge. Feature freeze Sun 11:00.
- Stack (Bas decides): Vite + React web app on Vercel, plus a Node call server on Hugin behind a Cloudflare tunnel (WebSockets; Vercel can't hold calls).
- Accounts: Sverre (17) keeps using his own ElevenLabs/Telnyx accounts, and accepts the 18+ ToS risk.

## Open

- Callback (they call back): see the options in chat.
- Legal: AI disclosure, personal data on calls (research tonight).
