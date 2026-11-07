# Jury Q&A

Short answers to the hard questions. Criteria (Saturday slides): functionality, real problem, innovation, design, team efficiency. Facts come from the code and from research notes. Lines marked **(verify)** need a test before we say them. Pitch details live in [PITCH.md](PITCH.md).

## Facts we can state

| Fact | Where it is true |
|---|---|
| Says it is an AI in the first sentence ("KI-assistent som ringer på vegne av …") | `server/src/llm/prompt.ts` |
| Never calls emergency numbers (110, 112, 113 and others); points to the emergency text service | `server/src/call/safety.ts` |
| Never agrees to a price, time or booking without the user's YES | approval cards, `server/src/call/approval.ts` |
| Never says card numbers; asks for preferences, not diagnoses | product rules, SPEC.md |
| Stores profile, contacts and call **summaries** only; no audio or transcripts in the database. Debug logging is off on the public server | `server/db/schema.sql`, `ops/run-server.sh` |
| The app talks only to our server; the database is locked (RLS on, no public access) | security check 2026-11-07 |
| Per-IP limits; real calls need a passcode and an allow-listed number | `server/src/app.ts` |
| In-app feedback after every call and in Profile | `POST /api/feedback` |

## Hard questions

| Question | Answer (EN) | Svar (NO) |
|---|---|---|
| Mio shut down: people prefer to call themselves. Why you? | Mio served people who *can* call. For a Deaf person the call is impossible, not annoying. | Mio var for folk som *kan* ringe. For en døv er samtalen umulig, ikke bare ubehagelig. |
| Nav already offers interpreters for free. | Nav's video interpreting service runs weekdays 08–20 and needs an approval first. A pharmacy question at 21:00 isn't worth an interpreter slot. We take the small calls. | Bildetolktjenesten er åpen hverdager 08–20 og krever vedtak. Et spørsmål til apoteket kl. 21 er ikke verdt en tolketime. Vi tar de små samtalene. |
| Is it legal for an AI to call a business? | It says it's an AI in the first sentence (EU AI Act Art. 50), the user starts every call, and it never sells. Norwegian details: we're asking a lawyer. | Den sier at den er KI i første setning, brukeren starter hver samtale, og den selger aldri. Norske detaljer sjekker vi med advokat. |
| What about privacy? Health calls? | Data sits in the EU (Supabase, Ireland). No audio and no transcripts stored, only a short summary. Speech and AI run at ElevenLabs and OpenRouter, both outside the EU; that is in our data map. | Data lagres i EU. Ingen lyd og ingen transkripsjon lagres, bare et kort sammendrag. Tale og KI går via ElevenLabs og OpenRouter utenfor EU; det står i dataoversikten vår. |
| What if it books the wrong thing? | It can't. Price, time and booking come back to you as YES/NO, with the live text in front of you. | Den kan ikke. Pris, tid og booking kommer tilbake til deg som JA/NEI, med live tekst. |
| Can it be used for prank calls or harassment? | Emergency numbers are blocked, calls are rate-limited, and real calls go to approved numbers only. Production adds BankID login. | Nødnumre er sperret, antall samtaler er begrenset, og ekte samtaler går bare til godkjente numre. I drift kommer BankID-innlogging. |
| What if a menu says "press 1"? | Spoken presses the right key and listens again. (mock-tested; verify on a real line) | Spoken trykker riktig tast og lytter videre. **(verify)** |
| What if nobody answers or it hits voicemail? | It hangs up and tells you nobody answered, so you can try later. (mock-tested; verify on a real line) | Den legger på og sier at ingen svarte, så du kan prøve igjen. **(verify)** |
| What if the shop wants to speak to you? | Spoken explains you can't take calls and sends their question to you as text. (mock-tested; verify on a real line) | Spoken forklarer at du ikke kan ta telefonen og sender spørsmålet til deg som tekst. **(verify)** |
| How can the shop call back? | Not yet. Next step: your own number, with replies as text. | Ikke ennå. Neste steg: ditt eget nummer, med svar som tekst. |
| Does it actually work? | X of Y real test calls got the job done. **(verify: fill in after test calls)** | X av Y ekte testsamtaler fikk jobben gjort. **(verify)** |
| Have Deaf people tested it? | One Deaf user gave feedback; the app now collects feedback after every call. Quote her only with her written OK. | Én døv bruker har gitt tilbakemelding; appen samler nå tilbakemelding etter hver samtale. |
| How do you make money? | Pay per call, about 29 kr; our cost is about 2 kr. Later: hearing organisations and municipalities buy it for their members. | Betal per samtale, rundt 29 kr; kostnaden vår er rundt 2 kr. Senere: hørselsorganisasjoner og kommuner kjøper det til medlemmene. |
| Does it scale? | Under 2 kr per call, nothing per user. Swedish and Danish need a new prompt. The home server is a hackathon choice. | Under 2 kr per samtale. Svensk og dansk krever bare ny prompt. Hjemmeserveren er et hackathon-valg. |
