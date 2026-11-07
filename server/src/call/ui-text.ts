// What the app shows the user (notes and fixed result summaries), per app language.
// Not what is said on the phone: that is lines.ts, in the call language.
import type { Lang } from "../../../shared/contract.ts";

export interface UiText {
  /** Approval rule added to every plan. */
  anyPrice: string;
  priceLimit: (limit: string) => string;
  confirmBooking: string;
  noNumber: string;
  summary: {
    notConnected: string;
    noAnswer: string;
    done: string;
    byYou: string;
    unclearConfirm: string;
    noDeal: string;
    heardNothing: string;
    misunderstood: string;
    stuck: (min: number) => string;
    userHungUp: string;
    maxTime: (len: string) => string;
  };
  note: {
    cantCall: (err: string) => string;
    refusedCard: string;
    refusedFnr: string;
    stoppedCommit: string;
    dtmf: (d: string) => string;
    dtmfFailed: (d: string, err: string) => string;
    llmSlow: string;
    hardToUnderstand: string;
    ttsFailed: string;
    message: (to: string, corrected: boolean, msg: string) => string;
    you: string;
    writeAnswer: string;
    instruction: (t: string) => string;
    tone: (t: "friendly" | "firm" | "hurry") => string;
    speaking: (call: Lang) => string;
  };
  blocked: {
    card: string;
    fnr: string;
    code: string;
    meta: string;
    fnrNotOk: string;
    addressNotOk: string;
  };
  hold: {
    asking: string;
    holding: (s: number) => string;
    remind: (s: number) => string;
    resumed: string;
    callback: string;
  };
}

export const UI_TEXT: Record<Lang, UiText> = {
  no: {
    anyPrice: "pris over 0 kr",
    priceLimit: (l) => `pris (grense: ${l.toLowerCase()})`,
    confirmBooking: "å bekrefte en bestilling eller time",
    noNumber: "Fant ikke nummeret. Skriv inn nummeret du vil at jeg skal ringe.",
    summary: {
      notConnected: "Samtalen kunne ikke kobles opp.",
      noAnswer: "Ingen svarte.",
      done: "Samtalen er ferdig.",
      byYou: "Avsluttet av deg.",
      unclearConfirm: "Uklart om de bekreftet bestillingen.",
      noDeal: "Ikke bekreftet: ingen godkjent avtale.",
      heardNothing: "Hørte ingenting fra mottakeren.",
      misunderstood: "Forsto ikke mottakeren; avsluttet høflig.",
      stuck: (m) => `Kom ikke videre på ${m} min; avsluttet høflig.`,
      userHungUp: "Brukeren valgte å legge på.",
      maxTime: (len) => `Maks samtaletid (${len}) nådd.`,
    },
    note: {
      cantCall: (e) => `Kunne ikke ringe: ${e}`,
      refusedCard: "Nektet å oppgi kortnummer.",
      refusedFnr: "Nektet å oppgi fødselsnummer (ikke godkjent for denne samtalen).",
      stoppedCommit: "Stoppet en forpliktelse som ikke var godkjent; spør deg først.",
      dtmf: (d) => `Trykker ${d} i telefonmenyen.`,
      dtmfFailed: (d, e) => `Kunne ikke trykke ${d}: ${e}`,
      llmSlow: "KI-en svarte ikke i tide.",
      hardToUnderstand: "Mottakeren er vanskelig å forstå; jeg prøver å spørre enklere.",
      ttsFailed: "Talen feilet; prøver videre.",
      message: (to, c, m) => `Beskjed til ${to}${c ? " (rettet)" : ""}: «${m}»`,
      you: "deg",
      writeAnswer: "Skriv svaret ditt i meldingsfeltet, så sier jeg det videre.",
      instruction: (t) => `Instruks sendt: ${t}`,
      tone: (t) => `Tone: ${{ friendly: "vennlig", firm: "bestemt", hurry: "rask" }[t]}`,
      speaking: (l) => (l === "en" ? "Snakker engelsk nå." : "Snakker norsk nå."),
    },
    blocked: {
      card: "Stoppet et kortnummer før det ble sagt.",
      fnr: "Stoppet et fødselsnummer som ikke var godkjent.",
      code: "Stoppet en sikkerhetskode før den ble sagt.",
      meta: "Fjernet en setning om systemet.",
      fnrNotOk: "Fødselsnummer ikke godkjent for denne samtalen.",
      addressNotOk: "Adresse ikke godkjent for denne samtalen.",
    },
    hold: {
      asking: "Venter på svaret ditt – spør om personen kan vente.",
      holding: (s) => `Personen venter… ${s} s (ventemusikk på)`,
      remind: (s) => `Personen venter… ${s} s`,
      resumed: "Ventemusikk av – du svarte, samtalen fortsetter.",
      callback: "Personen kunne ikke vente – tilbød å ringe tilbake senere.",
    },
  },
  en: {
    anyPrice: "any price above 0 kr",
    priceLimit: (l) => `price (limit: ${l.toLowerCase()})`,
    confirmBooking: "confirming an order or appointment",
    noNumber: "Couldn't find the number. Type the number you want me to call.",
    summary: {
      notConnected: "The call couldn't be connected.",
      noAnswer: "Nobody answered.",
      done: "The call is over.",
      byYou: "Ended by you.",
      unclearConfirm: "Unclear whether they confirmed the order.",
      noDeal: "Not confirmed: no approved deal.",
      heardNothing: "Heard nothing from the other side.",
      misunderstood: "Couldn't understand them; ended politely.",
      stuck: (m) => `No progress for ${m} min; ended politely.`,
      userHungUp: "You chose to hang up.",
      maxTime: (len) => `Maximum call length (${len}) reached.`,
    },
    note: {
      cantCall: (e) => `Couldn't place the call: ${e}`,
      refusedCard: "Refused to give a card number.",
      refusedFnr: "Refused to give an ID number (not approved for this call).",
      stoppedCommit: "Stopped a commitment you hadn't approved; asking you first.",
      dtmf: (d) => `Pressing ${d} in the phone menu.`,
      dtmfFailed: (d, e) => `Couldn't press ${d}: ${e}`,
      llmSlow: "The AI didn't answer in time.",
      hardToUnderstand: "They're hard to understand; I'll try asking more simply.",
      ttsFailed: "Speech failed; carrying on.",
      message: (to, c, m) => `Message for ${to}${c ? " (corrected)" : ""}: «${m}»`,
      you: "you",
      writeAnswer: "Type your answer in the message box and I'll pass it on.",
      instruction: (t) => `Instruction sent: ${t}`,
      tone: (t) => `Tone: ${{ friendly: "friendly", firm: "firm", hurry: "quick" }[t]}`,
      speaking: (l) => (l === "en" ? "Speaking English now." : "Speaking Norwegian now."),
    },
    blocked: {
      card: "Stopped a card number before it was said.",
      fnr: "Stopped an ID number that wasn't approved.",
      code: "Stopped a security code before it was said.",
      meta: "Removed a sentence about the system.",
      fnrNotOk: "ID number not approved for this call.",
      addressNotOk: "Address not approved for this call.",
    },
    hold: {
      asking: "Waiting for your answer – asking if they can hold.",
      holding: (s) => `They're holding… ${s} s (hold music on)`,
      remind: (s) => `They're holding… ${s} s`,
      resumed: "Hold music off – you answered, the call continues.",
      callback: "They couldn't hold – offered to call back later.",
    },
  },
};

/** The UI text for a language (Norwegian when unset). */
export function uiText(lang: Lang | undefined): UiText {
  return UI_TEXT[lang === "en" ? "en" : "no"];
}

/** Is this approval rule already about price? */
export function isPriceRule(rule: string): boolean {
  return /^(pris|price|any price)/i.test(rule.trim());
}
