// Fake phone line with a scripted pizza-shop callee (Norwegian or English). No keys, no audio:
// it reacts to what the agent says and paces itself like a real call.

import type { Lang, Word } from "../../../shared/contract.ts";
import type { CallLine, LineEvents, SpeakKind } from "./line.ts";

const SCRIPT = {
  greet: "Hei, du har kommet til Domino's Storo. Det går helt fint. Hva kan jeg hjelpe deg med?",
  price: "En stor pepperoni til henting klokka 18:00, det blir 189 kroner. Skal jeg legge inn bestillingen?",
  card: "Flott! Kan jeg få kortnummeret ditt, så betaler vi med en gang?",
  name: "Ja da, du kan betale når du henter. Hvilket navn skal bestillingen stå på?",
  bye: "Supert, den er klar klokka 18:00. Ha det bra!",
  declined: "Den er grei. Ha det!",
  repeat: "Hæ? Unnskyld, hva sa du?",
  menu: "Velkommen til Domino's. For kundeservice, trykk 2. For bestilling, trykk 1.",
  human: "Kan jeg få snakke med personen selv, ikke en robot?",
  voicemail: "Du har kommet til telefonsvareren til Domino's Storo. Legg igjen en beskjed etter pipetonen.",
};

const SCRIPT_EN: typeof SCRIPT = {
  greet: "Hi, you've reached Domino's Storo. That's fine. How can I help you?",
  price: "One large pepperoni for pickup at 6 pm, that comes to 189 kroner. Shall I put the order in?",
  card: "Great! Can I have your card number, so we can pay right away?",
  name: "Sure, you can pay when you pick it up. What name should the order be under?",
  bye: "Lovely, it'll be ready at 6 pm. Goodbye!",
  declined: "No problem. Bye!",
  repeat: "Sorry, what did you say?",
  menu: "Welcome to Domino's. For customer service, press 2. For orders, press 1.",
  human: "Can I talk to the person themselves, not a robot?",
  voicemail: "You've reached the voicemail of Domino's Storo. Please leave a message after the tone.",
};

// What the agent said → the callee's next line, per language.
const NEXT: Record<Lang, Record<string, RegExp>> = {
  no: {
    declined: /nei takk|lar vi det være|avslutte/, bye: /ha det/, greet: /ki-assistent|en ki som|an ai calling/, price: /jeg vil gjerne|bestille/,
    card: /bekrefter|ja takk/, name: /kortnummer|betale ved henting|betalingslenke/, done: /står på|navnet er/, repeat: /si det en gang til|gjenta/, deaf: /døv|tekst/,
  },
  en: {
    declined: /no thanks|leave it|end the call/, bye: /goodbye|\bbye\b/, greet: /ai assistant|an ai calling/, price: /i'd like|order/,
    card: /confirm|yes please/, name: /card number|pay at pickup|payment link/, done: /under|name is/, repeat: /say that again|repeat/, deaf: /deaf|text|typ/,
  },
};

/** What the fake callee does: the normal pizza shop, a phone menu, a human demanding the person, or a machine. */
export type MockScenario = "pizza" | "ivr" | "human" | "voicemail";

// Words the fake STT is "unsure" about, so the UI can grey them out.
const UNSURE = new Set(["Storo.", "Storo", "pepperoni", "189"]);

export class MockLine implements CallLine {
  private ev!: LineEvents;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private stopSpeak?: () => void;
  private stage: keyof typeof SCRIPT | "start" = "start";
  private seg = 0;
  private closed = false;
  waitingSound: false | "typing" | "music" = false;
  /** Keys the agent pressed, for tests. */
  readonly dtmf: string[] = [];

  /** speed 1 ≈ real time; tests use ~0.02. */
  private script: typeof SCRIPT;
  private re: Record<string, RegExp>;
  constructor(private speed = 1, private scenario: MockScenario = "pizza", lang: Lang = "no") {
    this.script = lang === "en" ? SCRIPT_EN : SCRIPT;
    this.re = NEXT[lang];
  }

  async sendDtmf(digits: string) {
    this.dtmf.push(digits);
    // Key 1 = ordering: the menu hands over to the shop; anything else loops the menu once.
    if (this.scenario === "ivr" && !this.closed) {
      this.scenario = "pizza";
      void (async () => { await this.wait(700); if (!this.closed) { this.stage = "greet"; await this.talk(digits === "1" ? this.script.greet : this.script === SCRIPT ? "Det valget finnes ikke." : "That option doesn't exist."); } })();
    }
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => { this.timers.delete(t); resolve(); }, ms * this.speed);
      this.timers.add(t);
    });
  }

  async start(events: LineEvents) {
    this.ev = events;
    void (async () => {
      await this.wait(600);
      if (this.closed) return;
      events.status("ringing");
      await this.wait(1800);
      if (this.closed) return;
      events.status("connected");
      if (this.scenario === "voicemail") {
        await this.wait(400);
        await this.talk(this.script.voicemail);
        events.voicemail?.();
      }
    })();
  }

  /** Fake voice loudness at ~15 Hz while someone "talks", so the live visual works in mock mode. */
  private pulse(who: "callee" | "agent", ms: number) {
    let t = 0;
    const iv = setInterval(() => {
      t += 66;
      if (this.closed || t >= ms) { clearInterval(iv); this.ev.level?.(who, 0); return; }
      const v = 0.35 + 0.3 * Math.abs(Math.sin(t / 140)) + 0.15 * Math.sin(t / 47);
      this.ev.level?.(who, Math.round(Math.max(0.05, Math.min(1, v)) * 100) / 100);
    }, 66);
  }

  async speak(text: string, kind: SpeakKind) {
    // No audio in mock: "audio starts" when speaking starts. STT/TTS figures stay null.
    if (kind === "say") this.ev.metric?.({ kind: "first_audio", at: Date.now() });
    const words = text.split(/\s+/).length;
    this.pulse("agent", words * 260 * this.speed);
    const done = new Promise<{ interrupted: boolean }>((resolve) => {
      const t = setTimeout(() => { this.timers.delete(t); this.stopSpeak = undefined; resolve({ interrupted: false }); }, words * 260 * this.speed);
      this.timers.add(t);
      this.stopSpeak = () => { clearTimeout(t); this.timers.delete(t); this.stopSpeak = undefined; resolve({ interrupted: true }); };
    });
    const r = await done;
    if (!r.interrupted && kind === "say" && !this.closed) void this.respondTo(text);
    return r;
  }

  stopSpeaking() { this.stopSpeak?.(); }
  silenceMs() { return this.talking ? 0 : Infinity; }
  private talking = false;
  startWaitingSound(kind: "typing" | "music" = "typing") { this.waitingSound = kind; }
  stopWaitingSound() { this.waitingSound = false; }

  async hangup() {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private next(agentText: string): keyof typeof SCRIPT | null {
    const a = agentText.toLowerCase();
    const r = this.re;
    if (r.declined!.test(a)) return "declined";
    if (r.bye!.test(a)) return null;
    if (r.greet!.test(a) && this.stage === "start") return this.scenario === "ivr" ? "menu" : this.scenario === "voicemail" ? null : "greet";
    if (this.scenario === "human" && r.price!.test(a) && this.stage === "greet") { this.scenario = "pizza"; return "human"; }
    if (this.stage === "human" && r.deaf!.test(a)) return null;
    if (r.price!.test(a) && (this.stage === "greet" || this.stage === "repeat")) return "price";
    if (r.card!.test(a) && this.stage === "price") return "card";
    if (r.name!.test(a) && this.stage === "card") return "name";
    if (r.done!.test(a) && this.stage === "name") return "bye";
    if (r.repeat!.test(a)) return this.stage === "start" ? "greet" : (this.stage as keyof typeof SCRIPT);
    return null;
  }

  private async respondTo(agentText: string) {
    const step = this.next(agentText);
    if (!step) return;
    this.stage = step;
    await this.wait(700);
    if (this.closed) return;
    await this.talk(this.script[step]);
  }

  /** Streams a callee line as partials, then a final with word confidences. */
  async talk(text: string) {
    const id = `c_${++this.seg}`;
    const parts = text.split(" ");
    this.ev.calleeSpeech();
    this.pulse("callee", (Math.ceil(parts.length / 3) * 330 + 250) * this.speed);
    this.talking = true;
    for (let i = 1; i <= parts.length; i += 3) {
      await this.wait(330);
      if (this.closed) return;
      this.ev.calleePartial(id, parts.slice(0, i).join(" "));
    }
    await this.wait(250);
    if (this.closed) return;
    this.talking = false;
    const words: Word[] = parts.map((w) => ({ text: w, confidence: UNSURE.has(w) ? 0.52 : 0.93 }));
    this.ev.calleeFinal(id, text, words);
  }
}
