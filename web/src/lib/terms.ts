import type { Lang } from "./i18n";

/*
 * Terms of use, shown at login and in Profile. The same text as mobile/src/lib/terms.ts, except
 * where the app says "this phone" this says "this browser". A plain-language draft for the hackathon test
 * version, not reviewed by a lawyer: it says so at the top. What it says about data must stay
 * true to the code and the server's settings (see PRODUCT_CONTEXT.md, "Safety, privacy and
 * authority"): server call logs are on unless CALL_LOG=0, and audio of the other side is saved
 * while SAVE_CALL_AUDIO=1. Change TERMS_VERSION whenever the meaning changes, so everyone is
 * asked to agree again.
 */

export const TERMS_VERSION = "2026-11-07b";

export interface TermsSection {
  h: string;
  body: string[];
}

export interface Terms {
  title: string;
  note: string;
  sections: TermsSection[];
}

const en: Terms = {
  title: "Terms of use",
  note: "This is a test version of Spoken made for a hackathon. These terms are a plain-language draft and have not been reviewed by a lawyer.",
  sections: [
    {
      h: "What Spoken does",
      body: [
        "Spoken is an AI assistant that makes phone calls for you. You type what you need, Spoken shows you a plan, and when you start the call it speaks to the other side with a computer voice. You follow the whole conversation as text and can tell Spoken things while it talks.",
        "Spoken always says at the start that it is an AI calling on your behalf, and the person it calls can say no or hang up.",
      ],
    },
    {
      h: "It's a test version",
      body: [
        "Spoken can mishear, misunderstand or say something wrong. Read the transcript and the result, and check anything important yourself.",
        "Demo calls are scripted and no phone rings. Real calls only happen with a code from the team.",
        "Don't use Spoken for emergencies. It won't call emergency numbers such as 110, 112 or 113: contact them directly.",
      ],
    },
    {
      h: "Agreements you approve",
      body: [
        "Spoken asks you before it agrees to a price, a time or a booking. When you approve, you are agreeing to it, through Spoken.",
        "A result only counts as agreed when it says so. If a call drops or ends unclear, treat it as not agreed.",
        "Spoken can't promise that the other side keeps to what was agreed.",
      ],
    },
    {
      h: "Using Spoken fairly",
      body: [
        "Only ask Spoken to make calls you could lawfully make yourself. Don't use it to harass, threaten, mislead or pretend to be someone else, and don't use it for scams or sales calls. Spoken refuses such tasks, and the team may stop calls that break these terms.",
        "Don't give Spoken more personal information than the call needs. Spoken tries to keep things like ID numbers and card numbers out of calls, but it can't catch everything.",
      ],
    },
    {
      h: "Your data",
      body: [
        "In this browser: your call history with full transcripts, your presets, your profile and your settings. You can delete call history in Profile → Call history.",
        "On the Spoken server: your account, which is your phone number (you log in with a code by text message); your name and phone number from Profile; saved contacts; a short summary of each call's result; and feedback you send.",
        "While Spoken is being tested, the server also keeps a log of each call, including the text of what was said, and may keep a recording of the other side's voice, to improve speech recognition. These are only used by the team to test and fix Spoken.",
        "To make calls, Spoken uses these services, which process the call: Vonage, 46elks or Telnyx (the phone line and the login text messages, depending on the setup), ElevenLabs (speech to text and the voice), OpenRouter and Anthropic (the AI model that decides what to say) and Supabase (the database).",
      ],
    },
    {
      h: "Questions and deleting your data",
      body: [
        "Use Send feedback in Profile to ask a question or to ask us to delete what the server has about you. Your feedback is linked to your account, so we can find your data.",
      ],
    },
    {
      h: "Changes",
      body: ["If these terms change, Spoken will ask you to agree again before you log in."],
    },
  ],
};

const no: Terms = {
  title: "Vilkår for bruk",
  note: "Dette er en testversjon av Spoken laget under et hackathon. Vilkårene er et utkast i vanlig språk og er ikke gjennomgått av en jurist.",
  sections: [
    {
      h: "Hva Spoken gjør",
      body: [
        "Spoken er en KI-assistent som ringer for deg. Du skriver hva du trenger, Spoken viser deg en plan, og når du starter samtalen snakker den med den andre parten med en datastemme. Du følger hele samtalen som tekst og kan gi Spoken beskjeder mens den snakker.",
        "Spoken sier alltid i starten at den er en KI som ringer på dine vegne, og den som blir ringt kan si nei eller legge på.",
      ],
    },
    {
      h: "Det er en testversjon",
      body: [
        "Spoken kan høre feil, misforstå eller si noe feil. Les samtalen og resultatet, og sjekk selv alt som er viktig.",
        "Demosamtaler er innspilte, og ingen telefon ringer. Ekte samtaler skjer bare med en kode fra teamet.",
        "Ikke bruk Spoken i nødsituasjoner. Den ringer ikke nødnumre som 110, 112 eller 113: kontakt dem direkte.",
      ],
    },
    {
      h: "Avtaler du godkjenner",
      body: [
        "Spoken spør deg før den sier ja til en pris, et tidspunkt eller en bestilling. Når du godkjenner, er det du som inngår avtalen, gjennom Spoken.",
        "Et resultat gjelder bare som avtalt når det står det. Hvis samtalen brytes eller ender uklart, regn det som ikke avtalt.",
        "Spoken kan ikke love at den andre parten holder det som ble avtalt.",
      ],
    },
    {
      h: "Bruk Spoken rettferdig",
      body: [
        "Be bare Spoken om samtaler du lovlig kunne tatt selv. Ikke bruk den til å trakassere, true, villede eller utgi deg for å være en annen, og ikke til svindel eller salgssamtaler. Spoken nekter slike oppdrag, og teamet kan stoppe samtaler som bryter vilkårene.",
        "Ikke gi Spoken flere personopplysninger enn samtalen trenger. Spoken prøver å holde ting som fødselsnummer og kortnummer utenfor samtalene, men den fanger ikke opp alt.",
      ],
    },
    {
      h: "Dataene dine",
      body: [
        "I denne nettleseren: samtalehistorikken med hele samtalene, snarveiene, profilen og innstillingene dine. Du kan slette historikken under Profil → Samtalehistorikk.",
        "På Spoken-serveren: kontoen din, som er telefonnummeret ditt (du logger inn med en kode på SMS); navnet og telefonnummeret fra profilen; lagrede kontakter; et kort sammendrag av resultatet av hver samtale; og tilbakemeldinger du sender.",
        "Mens Spoken testes, lagrer serveren også en logg over hver samtale, med teksten til det som ble sagt, og kan lagre et opptak av stemmen til den andre parten, for å forbedre talegjenkjenningen. Dette brukes bare av teamet til å teste og rette Spoken.",
        "For å ringe bruker Spoken disse tjenestene, som behandler samtalen: Vonage, 46elks eller Telnyx (telefonlinjen og SMS-ene med innloggingskode, avhengig av oppsettet), ElevenLabs (tale til tekst og stemmen), OpenRouter og Anthropic (KI-modellen som bestemmer hva som sies) og Supabase (databasen).",
      ],
    },
    {
      h: "Spørsmål og sletting",
      body: [
        "Bruk Send tilbakemelding i Profil for å stille et spørsmål eller be oss slette det serveren har om deg. Tilbakemeldingen er knyttet til kontoen din, så vi finner dataene dine.",
      ],
    },
    {
      h: "Endringer",
      body: ["Hvis vilkårene endres, ber Spoken deg godta dem på nytt før du logger inn."],
    },
  ],
};

export const TERMS: Record<Lang, Terms> = { en, no };
