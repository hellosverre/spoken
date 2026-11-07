import { COPY, type Copy, type Lang, type Row } from "./i18n";

/* Scripted calls for the demo. Each script talks to the call through CallIO,
   so a real call server can replace the script later without touching the UI. */

export type Who = "them" | "ai";

export interface AskOption {
  v: string;
  label: string;
}

export interface AskConfig {
  title: string;
  rows: Row[];
  /** What Spoken said to the other side while waiting for you. */
  hold: string;
  options: AskOption[];
  decline: string;
}

export type Outcome =
  | { hung: true }
  | { hung?: false; ok: boolean; title: string; rows: Row[] };

export interface CallIO {
  say(who: Who, text: string): Promise<void>;
  /** Resolves with the chosen option's `v`, or "no" when declined. */
  ask(cfg: AskConfig): Promise<string>;
}

interface BaseLines {
  contact: string;
  request: string;
  goal: string;
  checks: string[];
  opening: string;
}

export interface Scenario {
  init: string;
  number: string;
  en: BaseLines;
  no: BaseLines;
  run(lang: Lang, io: CallIO): Promise<Outcome>;
}

function defineScenario<L extends BaseLines>(s: {
  init: string;
  number: string;
  en: L;
  no: L;
  script(L: L, C: Copy, io: CallIO): Promise<Outcome>;
}): Scenario {
  return {
    init: s.init,
    number: s.number,
    en: s.en,
    no: s.no,
    run: (lang, io) => s.script(s[lang], COPY[lang], io),
  };
}

interface PizzaLines extends BaseLines {
  t1: string; a1x: string; t2: string; a2: string; t3: string; hold: string;
  apTitle: string; apRows: Row[];
  a3: string; t4: string; a4: string; t5: string; a3d: string; t4d: string;
  okTitle: string; okRows: Row[]; noTitle: string; noRows: Row[];
}

interface Slot extends AskOption {
  long: string;
}

interface DoctorLines extends BaseLines {
  t1: string; a1x: string; t2: string; hold: string;
  apTitle: string; apRows: Row[]; slots: Slot[]; none: string;
  a2: (slot: string) => string; t3: string; a3: string; t4: string; a4: string;
  a2d: string; t3d: string; a3d: string;
  okTitle: string; okRows: (slot: string) => Row[]; noTitle: string; noRows: Row[];
}

const pizza = defineScenario<PizzaLines>({
  init: "LP",
  number: "+47 22 12 34 56",
  en: {
    contact: "Løkka Pizza",
    request: "Order a large pepperoni for pickup at 18:30, max 250 kr",
    goal: "One large pepperoni, pickup 18:30, max 250 kr",
    checks: ["Price", "Pickup time"],
    opening: "Hi! I'm an AI assistant calling on behalf of Ingrid. She can't talk on the phone, so I'm speaking for her.",
    t1: "Løkka Pizza, hello?",
    a1x: " Could I place a pickup order?",
    t2: "Oh! Sure, go ahead.",
    a2: "One large pepperoni for pickup at 18:30, please.",
    t3: "Large pepperoni is 239 kroner. We're busy tonight, so the earliest is 18:40.",
    hold: "One moment, I'm checking with Ingrid.",
    apTitle: "239 kr, ready at 18:40",
    apRows: [["Price", "239 kr"], ["Pickup", "18:40"], ["You asked for", "18:30"]],
    a3: "That works. Please put it under the name Ingrid.",
    t4: "Got it. Ingrid, 18:40. Anything else?",
    a4: "No, that's all. Thank you!",
    t5: "Thanks, see you!",
    a3d: "Sorry, that doesn't work for her tonight. Thanks anyway!",
    t4d: "No problem, bye!",
    okTitle: "Order placed",
    okRows: [["Order", "Large pepperoni"], ["Price", "239 kr"], ["Pickup", "18:40, Løkka Pizza"], ["Name", "Ingrid"]],
    noTitle: "No order placed",
    noRows: [["Reason", "Pickup time didn't suit you"], ["Paid", "Nothing"]],
  },
  no: {
    contact: "Løkka Pizza",
    request: "Bestill en stor pepperoni til henting 18:30, maks 250 kr",
    goal: "Én stor pepperoni, henting 18:30, maks 250 kr",
    checks: ["Pris", "Hentetid"],
    opening: "Hei! Jeg er en KI-assistent som ringer på vegne av Ingrid. Hun kan ikke snakke i telefonen, så jeg snakker for henne.",
    t1: "Løkka Pizza, hallo?",
    a1x: " Kan jeg bestille til henting?",
    t2: "Å! Ja, bare si fra.",
    a2: "Én stor pepperoni til henting klokka 18:30, takk.",
    t3: "Stor pepperoni koster 239 kroner. Det er travelt i kveld, så tidligst 18:40.",
    hold: "Et øyeblikk, jeg sjekker med Ingrid.",
    apTitle: "239 kr, klar 18:40",
    apRows: [["Pris", "239 kr"], ["Henting", "18:40"], ["Du ba om", "18:30"]],
    a3: "Det går fint. Sett den på navnet Ingrid.",
    t4: "Skal bli. Ingrid, 18:40. Noe mer?",
    a4: "Nei, det var alt. Tusen takk!",
    t5: "Takk, ses!",
    a3d: "Beklager, det passer ikke for henne i kveld. Takk likevel!",
    t4d: "Helt i orden, ha det!",
    okTitle: "Bestillingen er lagt inn",
    okRows: [["Bestilling", "Stor pepperoni"], ["Pris", "239 kr"], ["Henting", "18:40, Løkka Pizza"], ["Navn", "Ingrid"]],
    noTitle: "Ingen bestilling",
    noRows: [["Grunn", "Hentetiden passet ikke"], ["Betalt", "Ingenting"]],
  },
  async script(L, C, x) {
    await x.say("them", L.t1);
    await x.say("ai", L.opening + L.a1x);
    await x.say("them", L.t2);
    await x.say("ai", L.a2);
    await x.say("them", L.t3);
    await x.say("ai", L.hold);
    const r = await x.ask({
      title: L.apTitle,
      rows: L.apRows,
      hold: L.hold,
      options: [{ v: "yes", label: C.approve }],
      decline: C.decline,
    });
    if (r === "yes") {
      await x.say("ai", L.a3);
      await x.say("them", L.t4);
      await x.say("ai", L.a4);
      await x.say("them", L.t5);
      return { ok: true, title: L.okTitle, rows: L.okRows };
    }
    await x.say("ai", L.a3d);
    await x.say("them", L.t4d);
    return { ok: false, title: L.noTitle, rows: L.noRows };
  },
});

const doctor = defineScenario<DoctorLines>({
  init: "BL",
  number: "+47 22 65 43 21",
  en: {
    contact: "Birkelunden legesenter",
    request: "Book an appointment with Dr. Nilsen about my sore knee, any morning this week",
    goal: "Appointment with Dr. Nilsen about a sore knee",
    checks: ["Day and time"],
    opening: "Hi! I'm an AI assistant calling on behalf of Ingrid Berg. She's Deaf, so I'm making this call for her.",
    t1: "Birkelunden legesenter, Kari speaking.",
    a1x: " She'd like an appointment with Dr. Nilsen about a sore knee.",
    t2: "Let me look. I have Thursday at 09:15, or next Monday at 14:00.",
    hold: "Give me a second, I'm asking Ingrid.",
    apTitle: "Pick a time",
    apRows: [["Doctor", "Dr. Nilsen"], ["Reason", "Sore knee"]],
    slots: [
      { v: "thu", label: "Thu 09:15", long: "Thursday at 09:15" },
      { v: "mon", label: "Mon 14:00", long: "Monday at 14:00" },
    ],
    none: "Neither works",
    a2: (s) => `${s} works great.`,
    t3: "Booked. Ask her to come ten minutes early and bring ID.",
    a3: "I'll tell her. Can you send the confirmation by text? She reads texts, not calls.",
    t4: "Of course, it's going out now.",
    a4: "Perfect, thank you. Bye!",
    a2d: "Neither works for her. Is there anything later in the week?",
    t3d: "Not right now, but she can check our website for cancellations.",
    a3d: "Thanks, I'll tell her. Bye!",
    okTitle: "Appointment booked",
    okRows: (s) => [["When", s], ["Doctor", "Dr. Nilsen"], ["Remember", "Come 10 min early, bring ID"], ["Confirmation", "Sent by SMS"]],
    noTitle: "No appointment yet",
    noRows: [["Tip", "Check their website for cancellations"]],
  },
  no: {
    contact: "Birkelunden legesenter",
    request: "Bestill time hos dr. Nilsen for kneet mitt, en formiddag denne uka",
    goal: "Time hos dr. Nilsen for vondt kne",
    checks: ["Dag og klokkeslett"],
    opening: "Hei! Jeg er en KI-assistent som ringer på vegne av Ingrid Berg. Hun er døv, så jeg tar samtalen for henne.",
    t1: "Birkelunden legesenter, det er Kari.",
    a1x: " Hun vil gjerne ha time hos dr. Nilsen for et vondt kne.",
    t2: "Jeg skal se. Jeg har torsdag 09:15, eller mandag 14:00.",
    hold: "Et lite øyeblikk, jeg spør Ingrid.",
    apTitle: "Velg en time",
    apRows: [["Lege", "Dr. Nilsen"], ["Grunn", "Vondt kne"]],
    slots: [
      { v: "thu", label: "Tor 09:15", long: "Torsdag 09:15" },
      { v: "mon", label: "Man 14:00", long: "Mandag 14:00" },
    ],
    none: "Ingen passer",
    a2: (s) => `${s} passer fint.`,
    t3: "Da er det booket. Hun må komme ti minutter før og ta med legitimasjon.",
    a3: "Jeg sier fra. Kan dere sende bekreftelsen på SMS? Hun leser meldinger, ikke samtaler.",
    t4: "Selvfølgelig, den sendes nå.",
    a4: "Supert, tusen takk. Ha det!",
    a2d: "Ingen av dem passer. Har dere noe senere i uka?",
    t3d: "Ikke nå, men hun kan følge med på nettsiden for avbestillinger.",
    a3d: "Takk, jeg sier fra. Ha det!",
    okTitle: "Timen er booket",
    okRows: (s) => [["Når", s], ["Lege", "Dr. Nilsen"], ["Husk", "Kom 10 min før, ta med legitimasjon"], ["Bekreftelse", "Sendt på SMS"]],
    noTitle: "Ingen time ennå",
    noRows: [["Tips", "Følg med på nettsiden for avbestillinger"]],
  },
  async script(L, _C, x) {
    await x.say("them", L.t1);
    await x.say("ai", L.opening + L.a1x);
    await x.say("them", L.t2);
    await x.say("ai", L.hold);
    const r = await x.ask({
      title: L.apTitle,
      rows: L.apRows,
      hold: L.hold,
      options: L.slots,
      decline: L.none,
    });
    const slot = L.slots.find((s) => s.v === r);
    if (slot) {
      await x.say("ai", L.a2(slot.long));
      await x.say("them", L.t3);
      await x.say("ai", L.a3);
      await x.say("them", L.t4);
      await x.say("ai", L.a4);
      return { ok: true, title: L.okTitle, rows: L.okRows(slot.long) };
    }
    await x.say("ai", L.a2d);
    await x.say("them", L.t3d);
    await x.say("ai", L.a3d);
    return { ok: false, title: L.noTitle, rows: L.noRows };
  },
});

export const SCENARIOS = { pizza, doctor };
export type ScenarioKey = keyof typeof SCENARIOS;

/** Pick a script from what the person typed. */
export const detect = (text: string): ScenarioKey =>
  /doctor|lege|appointment|dentist|tannlege|\btime\b|clinic|knee|kne/i.test(text) ? "doctor" : "pizza";
