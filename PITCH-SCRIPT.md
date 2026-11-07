# Pitch-manus: 2 minutter, live demo hele veien

Åpen runde: 2 min demo + 1 min spørsmål. Kriterier: funksjonalitet, ekte problem, innovasjon, design, teameffektivitet. Spørsmål og svar: [JURY-QA.md](JURY-QA.md). Forberedelser: [PITCH.md](PITCH.md).

Samtalen går **uten lyd i rommet**. Juryen følger live-teksten på skjermen, og vi snakker om produktet mens samtalen pågår. Ca. 260 ord.

## Manus

**[0:00, appen åpen]**
«Nå skal jeg ringe en av dere, uten å si et ord.»

**[Skriver oppgaven]**
«For de fleste er en telefonsamtale hverdag. For døve er den umulig. I dag må de ringe via teksttelefon eller Navs bildetolk. De er avhengige av et annet menneske for å bestille en time eller spørre apoteket om noe.»

**[Oppfølgingsspørsmål → plan]**
«Spoken spør om det som mangler og viser meg planen. Jeg velger om samtalen skal være på norsk eller engelsk. Ingenting skjer før jeg trykker OK.»

**[Det ringer → samtalen pågår]**
«Først sier Spoken at den er en KI som ringer på vegne av meg. Det personen sier, ser jeg som tekst her. Det jeg skriver, sier Spoken høyt.»

«Vi spurte en døv bruker fra OsloMet hva hun trengte. Svaret var tale til tekst og tekst til tale, i én og samme app. Det har vi bygd. Tegnspråkoversettelse lot vi bevisst ligge, for fagmiljøet selv sier at det tar år.»

«Spoken er for døve og stumme, men også for alle med telefonangst eller som bare ikke liker å ringe.»

**[JA/NEI-kortet dukker opp. Stopp midt i setningen om du må]**
«Her foreslår de en pris. Spoken godtar aldri noe uten meg.» *Trykk JA.*

**[Samtalen er ferdig → resultatkort]**
«Ferdig. Jeg får resultatet og hele samtalen som tekst. Kundene våre er Nav og kommunene, som et hjelpemiddel. En samtale koster oss rundt to kroner.»

**[Avslutning]**
«Bygd for døve, nyttig for alle. Du skriver, vi snakker.»

## Regler

- **Manuset er i blokker.** Samtalelengden varierer. Blokkene om OsloMet og målgruppen kan kuttes eller strekkes. JA/NEI-kortet går foran alt annet.
- **Gi jurymedlemmet en lapp** med 2–3 replikker («Det blir 189 kr, klar 18:30»). Da kommer JA/NEI-kortet garantert, og samtalen holder seg under ca. 45 sekunder.
- **Stor tekst på projektoren.** Juryen ser samtalen, de hører den ikke. Test lesbarheten i selve rommet.
- **Reserveplan.** Ha et opptak klart i en annen fane. Svarer ingen innen 10 sekunder: «Her er en samtale vi tok i dag», og bytt til opptaket.

## Før scenen

- [ ] **Engelsk samtale:** koden støtter `callLang: "en"` (`server/src/app.ts`). Test en ekte engelsk samtale før vi sier det høyt.
- [ ] **OsloMet-sitatet:** skriftlig OK fra brukeren før vi refererer til henne eller nevner OsloMet. Uten det sier vi «en døv bruker vi snakket med».
- [ ] **GDPR (bare hvis spurt):** bruk svaret i [JURY-QA.md](JURY-QA.md). Sjekk først at `SAVE_CALL_AUDIO` er av på den offentlige serveren.
- [ ] **Teknikk 5 min før:** serveren kjører, passkoden er satt, jurymedlemmets nummer er godkjent, mobilen er ladet og ikke på lydløs, nettet er testet.
