// Everything the agent says on its own (not from the LLM), per call language.
// The call language is the language spoken on the phone, not the app's UI language.
import type { Lang } from "../../../shared/contract.ts";

export interface Lines {
  wait: string;
  fillers: string[];
  backchannels: string[];
  whoAreYou: (name: string, goal: string) => string;
  card: string;
  fnr: string;
  address: string;
  pickupNoAddress: string;
  refusalUnsure: string;
  misunderstood: (name: string) => string;
  rephrase: string;
  wrapUp: (name: string) => string;
  hello: string;
  cantHear: string;
  mustEnd: string;
  checking: (name: string) => string[];
  hold: {
    ask: (name: string) => string;
    thanks: string;
    remind: string;
    stillHere: string;
    back: string;
    callback: string;
  };
  user: string; // «the user» when no name is set
}

export const LINES: Record<Lang, Lines> = {
  no: {
    wait: "Et øyeblikk…",
    fillers: ["La meg se.", "Ett sekund."],
    backchannels: ["Ja.", "Okei.", "Skjønner."],
    whoAreYou: (name, goal) => `Jeg er en KI-assistent. ${name} ba meg ringe for å ${goal}.`,
    card: "Beklager, jeg kan ikke oppgi kortnummer, sikkerhetskode eller PIN over telefon. Kan vi betale ved henting, eller med en betalingslenke?",
    fnr: "Beklager, jeg har ikke lov til å oppgi fødselsnummer i denne samtalen.",
    address: "Et lite øyeblikk.",
    pickupNoAddress: "Det er til henting, så vi trenger ingen adresse.",
    refusalUnsure: "Beklager, jeg hørte deg ikke helt. Er det greit at jeg spør om noe kort?",
    misunderstood: (name) => `Beklager, jeg tror vi misforstår hverandre litt. ${name} tar kontakt igjen. Ha det bra!`,
    rephrase: "Unnskyld, er det mulig?",
    wrapUp: (name) => `Takk for hjelpen så langt. Jeg gir beskjed til ${name}, så tar vi kontakt igjen. Ha det bra!`,
    hello: "Hallo, hører du meg?",
    cantHear: "Jeg hører deg dessverre ikke. Jeg prøver igjen senere. Ha det!",
    mustEnd: "Jeg må dessverre avslutte nå. Takk, ha det bra!",
    checking: (name) => [`Et lite øyeblikk, jeg sjekker med ${name}.`, `Jeg sjekker det med ${name}.`],
    hold: {
      ask: (name) => `Beklager ventetiden. Jeg får ikke helt kontakt med ${name} akkurat nå. Har du mulighet til å vente litt?`,
      thanks: "Tusen takk!",
      remind: "Takk for at du venter, jeg er straks tilbake.",
      stillHere: "Jeg er her fortsatt. Takk for at du venter.",
      back: "Takk for at du ventet!",
      callback: "Beklager at det tar tid. Jeg ringer heller tilbake senere. Tusen takk for tålmodigheten, ha det bra!",
    },
    user: "brukeren",
  },
  en: {
    wait: "One moment…",
    fillers: ["Let me see.", "One second."],
    backchannels: ["Yes.", "Okay.", "I see."],
    // The goal may be in Norwegian (the language was switched after planning): leave it out.
    whoAreYou: (name) => `I'm an AI assistant calling on behalf of ${name}.`,
    card: "Sorry, I can't give card numbers, security codes or PINs over the phone. Could we pay at pickup, or with a payment link?",
    fnr: "Sorry, I'm not allowed to share an ID number on this call.",
    address: "Just a moment.",
    pickupNoAddress: "It's for pickup, so you won't need an address.",
    refusalUnsure: "Sorry, I didn't quite catch that. Is it okay if I ask something quickly?",
    misunderstood: (name) => `Sorry, I think we're misunderstanding each other a little. ${name} will get back to you. Goodbye!`,
    rephrase: "Sorry, is that possible?",
    wrapUp: (name) => `Thanks for your help so far. I'll let ${name} know, and we'll be in touch. Goodbye!`,
    hello: "Hello, can you hear me?",
    cantHear: "I'm afraid I can't hear you. I'll try again later. Goodbye!",
    mustEnd: "I'm afraid I have to end the call now. Thank you, goodbye!",
    checking: (name) => [`Just a moment, I'll check with ${name}.`, `Let me check that with ${name}.`],
    hold: {
      ask: (name) => `Sorry for the wait. I can't quite reach ${name} right now. Could you hold for a moment?`,
      thanks: "Thank you so much!",
      remind: "Thanks for holding, I'll be right back.",
      stillHere: "I'm still here. Thanks for holding.",
      back: "Thanks for waiting!",
      callback: "Sorry this is taking a while. I'll call you back later instead. Thanks for your patience, goodbye!",
    },
    user: "the user",
  },
};

/** «på norsk» / «in English» in what the user typed or said picks the call language. */
export function langFromText(text: string): Lang | undefined {
  if (/\b(in|speak|talk|on|to|use) english\b|\bpå engelsk\b|\bsnakk engelsk\b/i.test(text)) return "en";
  if (/\b(in|speak|talk|to|use) norwegian\b|\bpå norsk\b|\bsnakk norsk\b/i.test(text)) return "no";
  return undefined;
}

const NO_WORDS = /[æøå]|\b(bestill\w*|jeg|og|på|til|fra|hos|klokka|kl|ring|vil|kan|ikke|med|en|ei|et|stor|frisør|lege|mamma|time|avbestill\w*|henting|levering)\b/gi;
const EN_WORDS = /\b(order|book|call|the|for|from|at|please|a|an|and|my|to|with|appointment|large|pickup|delivery|haircut|doctor|mom|cancel|pm|am)\b/gi;

/** Which language the task was typed in, when it is clear (two more marker words than the other). */
export function guessLang(text: string): Lang | undefined {
  const no = text.match(NO_WORDS)?.length ?? 0;
  const en = text.match(EN_WORDS)?.length ?? 0;
  if (no - en >= 2) return "no";
  if (en - no >= 2) return "en";
  return undefined;
}

/** The call language for a task: an explicit cue, else the language it was typed in, else the default. */
export function callLangFor(text: string, fallback: Lang): Lang {
  return langFromText(text) ?? guessLang(text) ?? fallback;
}
